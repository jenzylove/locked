// Minimal client for the Switch agent protocol: SSE events in, HTTP out.
import { randomUUID } from "node:crypto";
import { createParser } from "eventsource-parser";

export interface SwitchMessage {
  roomId: string;
  addressed: boolean;
  sender: string;
  senderName: string;
  messageId: string;
  body: string;
  threadId?: string;
  timestamp: number;
}

export interface RegisterInput {
  bridgeUrl: string;
  registrationKey: string;
  name: string;
  displayName?: string;
  description: string;
  overwrite?: boolean;
}

export async function registerAgent(input: RegisterInput): Promise<{ id: string; api_key: string }> {
  const res = await fetch(`${trim(input.bridgeUrl)}/agents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.registrationKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      display_name: input.displayName,
      description: input.description,
      connector_type: "custom",
      overwrite: input.overwrite ?? false,
      integration_profile: {
        connection_model: "always_on",
        message_exchange: true,
        pre_invocation_mediation: [],
        post_invocation_mediation: [],
        event_reporting: [],
      },
    }),
  });
  if (!res.ok) throw new Error(`register ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string; api_key: string };
}

export class SwitchAgent {
  readonly connectionId = randomUUID();
  private cursor = 0;
  private beat?: NodeJS.Timeout;
  private abort?: AbortController;
  private stopped = false;

  constructor(
    private bridgeUrl: string,
    readonly agentId: string,
    private apiKey: string,
    private log: (line: string) => void = (l) => console.log(`[switch] ${l}`),
  ) {
    this.bridgeUrl = trim(bridgeUrl);
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...extra };
  }

  async op<T = unknown>(operation: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.bridgeUrl}/agents/${this.agentId}/ops/${operation}`, {
      method: "POST",
      headers: this.headers({ "X-Switch-Connection-Id": this.connectionId }),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`${operation} ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { result: T };
    return json.result;
  }

  /** Post without needing a live connection. */
  async post(roomId: string, content: string): Promise<void> {
    const res = await fetch(`${this.bridgeUrl}/agents/${this.agentId}/message`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ room_id: roomId, content }),
    });
    if (!res.ok) throw new Error(`post ${res.status}: ${await res.text()}`);
  }

  async listRooms(): Promise<unknown> {
    return this.op("list_rooms", {});
  }

  /** Open the event stream (scope all) and keep it alive until stop(). */
  async listen(onMessage: (m: SwitchMessage) => void | Promise<void>): Promise<void> {
    while (!this.stopped) {
      try {
        await this.openStream(onMessage);
      } catch (err) {
        if (this.stopped) return;
        this.log(`stream dropped: ${(err as Error).message}; reopening`);
      }
      await sleep(1500);
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.beat);
    this.abort?.abort();
  }

  private async openStream(onMessage: (m: SwitchMessage) => void | Promise<void>) {
    this.abort = new AbortController();
    const qs = new URLSearchParams({
      connection_id: this.connectionId,
      scope: "all",
      filter: "all",
      start_from: this.cursor ? String(this.cursor) : "head",
      client: "locked",
      client_version: "0.1.0",
    });
    const res = await fetch(`${this.bridgeUrl}/agents/${this.agentId}/events?${qs}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "text/event-stream" },
      signal: this.abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`events ${res.status}: ${await res.text()}`);

    let interval = 2000;
    const parser = createParser({
      onEvent: (ev) => {
        let data: any;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (ev.id) this.cursor = Number(ev.id);
        const type = ev.event ?? data.type;
        if (type === "connection_state") {
          interval = (data.heartbeat_interval_seconds ?? 2) * 1000;
          this.startBeat(interval);
          this.log(`connected, rooms: ${(data.rooms ?? []).join(", ") || "none"}`);
        } else if (type === "evicted") {
          this.log(`evicted: ${data.reason}`);
        } else if (type === "message") {
          const p = data.payload ?? {};
          void Promise.resolve(
            onMessage({
              roomId: data.room_id,
              addressed: Boolean(p.addressed),
              sender: p.sender ?? "",
              senderName: p.sender_name ?? "",
              messageId: p.message_id ?? "",
              body: p.body ?? "",
              threadId: p.thread_id,
              timestamp: p.timestamp ?? Date.now(),
            }),
          ).catch((e) => this.log(`handler error: ${(e as Error).message}`));
        }
      },
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      clearInterval(this.beat);
    }
  }

  private startBeat(ms: number) {
    clearInterval(this.beat);
    this.beat = setInterval(async () => {
      try {
        const res = await fetch(`${this.bridgeUrl}/agents/${this.agentId}/connection/beat`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ connection_id: this.connectionId, cursor: this.cursor }),
        });
        if (res.status === 404 || res.status === 409) this.abort?.abort();
      } catch {
        /* next beat retries; a stale TTL makes the stream reopen */
      }
    }, ms);
  }
}

const trim = (u: string) => u.replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Locked engine: a Switch agent on the team server. Sidecars send intents over HTTP; the engine forecasts breaks,
// runs interface agreements, rehearses merges, and keeps the room informed.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { SwitchAgent, type SwitchMessage } from "../switch/client.js";
import { forecast } from "../forecast/forecast.js";
import { propose, respond, approve, reject, escalate } from "../contract/contract.js";
import { rehearse } from "../rehearsal/rehearse.js";
import { renderBoard, renderConflict, renderContract } from "./board.js";
import { loadState, saveState, nextContractId, type EngineState } from "./state.js";
import type { Conflict, Contract, Intent } from "../types.js";

const run = promisify(execFile);
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const cfg = {
  bridge: env("SWITCH_BRIDGE_URL"),
  agentId: env("LOCKED_AGENT_ID"),
  apiKey: env("LOCKED_API_KEY"),
  roomId: env("LOCKED_ROOM_ID"),
  leads: env("LOCKED_LEADS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  teamToken: env("LOCKED_TEAM_TOKEN"),
  repoDir: env("LOCKED_REPO_DIR"),
  baseRef: env("LOCKED_BASE_REF", "origin/main"),
  checks: env("LOCKED_CHECKS", "npm run typecheck,npm test").split(",").map((s) => s.trim()),
  port: Number(env("LOCKED_PORT", "7420")),
  statePath: env("LOCKED_STATE", join(process.cwd(), ".locked", "engine-state.json")),
};

const agent = new SwitchAgent(cfg.bridge, cfg.agentId, cfg.apiKey);
const state: EngineState = loadState(cfg.statePath, cfg.repoDir.split(/[\\/]/).pop() ?? "repo");
const persist = () => saveState(cfg.statePath, state);
const say = (text: string) => agent.post(cfg.roomId, text).catch((e) => console.error("post failed", e.message));

let boardTimer: NodeJS.Timeout | undefined;
function postBoardSoon() {
  clearTimeout(boardTimer);
  boardTimer = setTimeout(() => {
    void say(renderBoard({ ...boardInput(), now: Date.now() }));
    state.boardMessageAt = Date.now();
    persist();
  }, 4000);
}

function boardInput() {
  const intents = Object.values(state.intents);
  return {
    repo: state.repo,
    intents,
    conflicts: forecast(intents),
    contracts: Object.values(state.contracts),
    lastRehearsal: state.lastRehearsal,
  };
}

async function onIntent(intent: Intent) {
  const prev = state.intents[intent.dev];
  state.intents[intent.dev] = intent;
  const conflicts = forecast(Object.values(state.intents));
  const fresh = conflicts.filter((c) => !state.announced.includes(c.id));
  for (const c of fresh) {
    state.announced.push(c.id);
    await say(renderConflict(c));
  }
  persist();
  if (!prev || fresh.length || prev.symbols.length !== intent.symbols.length) postBoardSoon();
  scheduleRehearsal();
  return conflicts;
}

let rehearsing = false;
let rehearseAgain = false;
let rehearseTimer: NodeJS.Timeout | undefined;
function scheduleRehearsal() {
  clearTimeout(rehearseTimer);
  rehearseTimer = setTimeout(() => void runRehearsal(), 5000);
}

async function runRehearsal() {
  if (rehearsing) {
    rehearseAgain = true;
    return;
  }
  const withRefs = Object.values(state.intents).filter((i) => i.wipRef);
  if (withRefs.length < 2) return;
  rehearsing = true;
  try {
    await run("git", ["fetch", "--quiet", "origin", "+refs/locked/*:refs/locked/*", "main"], { cwd: cfg.repoDir });
    const [a, b] = withRefs.slice(-2);
    const result = await rehearse({
      repoDir: cfg.repoDir,
      base: cfg.baseRef,
      a: { dev: a.dev, ref: a.wipRef! },
      b: { dev: b.dev, ref: b.wipRef! },
      checks: cfg.checks,
      timeoutMs: 180_000,
    });
    const changed = JSON.stringify(result) !== JSON.stringify(state.lastRehearsal);
    state.lastRehearsal = result;
    persist();
    if (changed) {
      const line =
        result.status === "clean"
          ? `✅ Merge rehearsal: ${result.branches.join(" + ")} merge clean and pass ${result.checks.join(", ")}.`
          : result.status === "text_conflict"
            ? `⚠️ Merge rehearsal: ${result.branches.join(" + ")} conflict as text in ${result.files.join(", ")}.`
            : `❌ Merge rehearsal: ${result.branches.join(" + ")} pass alone but fail together.\n\`\`\`\n${result.output}\n\`\`\``;
      await say(line);
      postBoardSoon();
    }
  } catch (e) {
    await say(`Merge rehearsal could not run: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    rehearsing = false;
    if (rehearseAgain) {
      rehearseAgain = false;
      scheduleRehearsal();
    }
  }
}

function saveContract(c: Contract) {
  state.contracts[c.id] = c;
  persist();
}

async function announceContract(c: Contract) {
  let text = renderContract(c);
  if (c.state === "accepted" && c.needsLead) text += `\nTech lead: reply \`@locked approve ${c.id}\` or \`@locked reject ${c.id}\`.`;
  await say(text);
  postBoardSoon();
}

const isLead = (who: string) => cfg.leads.includes(who.toLowerCase());

async function onRoomMessage(m: SwitchMessage) {
  if (!m.addressed || m.roomId !== cfg.roomId) return;
  const text = m.body.replace(/@\S+/g, " ").trim();
  const [verb, arg] = text.split(/\s+/);
  const v = (verb ?? "").toLowerCase();
  const who = m.senderName || m.sender;
  if (v === "board" || v === "") return void say(renderBoard({ ...boardInput(), now: Date.now() }));
  if (v === "approve" || v === "reject") {
    const c = state.contracts[(arg ?? "").toUpperCase()];
    if (!c) return void say(`I can't find agreement ${arg ?? ""}.`);
    if (!isLead(who)) return void say(`Only the tech lead (${cfg.leads.join(", ")}) can ${v} shared interface changes. ${who}, I've left ${c.id} as it is.`);
    try {
      const next = v === "approve" ? approve(c, who, true, Date.now()) : reject(c, who, true, Date.now());
      saveContract(next);
      return void announceContract(next);
    } catch (e) {
      return void say(`${c.id}: ${(e as Error).message}`);
    }
  }
  if (v === "why") {
    const c = forecast(Object.values(state.intents)).find((x) => x.id.toLowerCase().includes((arg ?? "").toLowerCase()));
    if (!c) return void say("No open heads up matches that.");
    return void say(`${c.summary}\n${c.evidence.map((e) => `• ${e}`).join("\n")}`);
  }
  if (v === "rehearse") return void runRehearsal();
  await say("I understand: `board`, `approve <id>`, `reject <id>`, `why <symbol>`, `rehearse`.");
}

// HTTP API for sidecars.
async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}
function send(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== `Bearer ${cfg.teamToken}`) return send(res, 401, { error: "bad team token" });
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "POST" && url.pathname === "/intent") {
      const conflicts = await onIntent(await body<Intent>(req));
      return send(res, 200, { conflicts });
    }
    if (req.method === "GET" && url.pathname === "/board") {
      const b = boardInput();
      return send(res, 200, { ...b, text: renderBoard({ ...b, now: Date.now() }) });
    }
    if (req.method === "GET" && url.pathname === "/conflicts") {
      const dev = url.searchParams.get("dev");
      const all: Conflict[] = boardInput().conflicts;
      return send(res, 200, dev ? all.filter((c) => c.devs.includes(dev)) : all);
    }
    if (req.method === "POST" && url.pathname === "/contracts") {
      const b = await body<Omit<Parameters<typeof propose>[0], "id" | "at">>(req);
      const c = propose({ ...b, id: nextContractId(state), at: Date.now() });
      saveContract(c);
      await announceContract(c);
      return send(res, 200, c);
    }
    if (req.method === "POST" && parts[0] === "contracts" && parts[2] === "respond") {
      const c = state.contracts[parts[1]];
      if (!c) return send(res, 404, { error: "no such agreement" });
      const b = await body<{ dev: string; answer: "accept" | "counter" | "escalate"; note?: string }>(req);
      const next = b.answer === "escalate" ? escalate(c, b.dev, Date.now()) : respond(c, b.dev, b.answer, b.note, Date.now());
      saveContract(next);
      await announceContract(next);
      return send(res, 200, next);
    }
    if (req.method === "GET" && parts[0] === "contracts") return send(res, 200, Object.values(state.contracts));
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
});

server.listen(cfg.port, () => console.log(`[locked] engine API on :${cfg.port}, room ${cfg.roomId}`));
void agent.listen(onRoomMessage);

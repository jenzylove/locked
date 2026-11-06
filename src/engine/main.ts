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
import { actingDev, parseDevTokens, resolveCaller } from "./auth.js";
import { draftAgreements } from "./draft.js";
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

let conflicts: Conflict[] = [];

function boardInput() {
  return {
    repo: state.repo,
    intents: Object.values(state.intents),
    conflicts,
    contracts: Object.values(state.contracts),
    lastRehearsal: state.lastRehearsal,
  };
}

const blob = (ref: string, file: string) =>
  run("git", ["rev-parse", `${ref}:${file}`], { cwd: cfg.repoDir }).then((r) => r.stdout.trim(), () => "missing");

/** Drop overlap warnings where both branches hold byte-identical files (for example one dev merged the other's commit). */
async function refreshConflicts(): Promise<Conflict[]> {
  const raw = forecast(Object.values(state.intents));
  await run("git", ["fetch", "--quiet", "origin", "+refs/locked/*:refs/locked/*"], { cwd: cfg.repoDir }).catch(() => undefined);
  const kept: Conflict[] = [];
  for (const c of raw) {
    if (c.kind !== "signature_break" && c.file) {
      const [a, b] = c.devs.map((d) => state.intents[d]?.wipRef);
      if (a && b && (await blob(a, c.file)) === (await blob(b, c.file))) continue;
    }
    kept.push(c);
  }
  conflicts = kept;
  return kept;
}

async function onIntent(intent: Intent) {
  const prev = state.intents[intent.dev];
  state.intents[intent.dev] = intent;
  await refreshConflicts();
  const fresh = conflicts.filter((c) => !state.announced.includes(c.id));
  state.announced.push(...fresh.map((c) => c.id));
  if (fresh.length === 1) await say(renderConflict(fresh[0]));
  else if (fresh.length > 1)
    await say(
      `**${fresh.length} new heads ups**\n` +
        fresh.map((c) => `${c.severity === "break" ? "🔴" : "🟡"} ${c.summary}`).join("\n") +
        `\nSay \`why <name>\` for the evidence on any of them.`,
    );
  for (const d of draftAgreements(fresh, Object.values(state.intents), Object.values(state.contracts))) {
    const c = propose({ ...d, id: nextContractId(state), at: Date.now() });
    saveContract(c);
    await say(`📝 Locked drafted an agreement so this gets settled before merge.\n${renderContract(c)}`);
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
            : `❌ Merge rehearsal: ${result.branches.join(" + ")} pass alone but fail together.\n\`\`\`\n${keyLines(result.output)}\n\`\`\``;
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

function keyLines(out: string): string {
  const lines = out.split(/\r?\n/);
  const hits = lines.filter((l) => /error TS|FAIL|AssertionError|Expected|Received|^\$ /.test(l));
  return (hits.length ? hits : lines.slice(-8)).slice(0, 10).join("\n");
}

function saveContract(c: Contract) {
  state.contracts[c.id] = c;
  persist();
}

async function announceContract(c: Contract) {
  let text = renderContract(c);
  if (c.state === "accepted" && c.needsLead) text += `\nTech lead: reply \`approve ${c.id}\` or \`reject ${c.id}\`.`;
  await say(text);
  postBoardSoon();
}

const isLead = (who: string) => cfg.leads.includes(who.toLowerCase());

const COMMANDS = /^(board|approve|reject|why|rehearse|help)\b/i;
const agentNames = new Set(env("LOCKED_IGNORE_SENDERS", "locked,ada,tolu").split(",").map((s) => s.trim().toLowerCase()));

async function onRoomMessage(m: SwitchMessage) {
  if (m.roomId !== cfg.roomId) return;
  const who = (m.senderName || m.sender).replace(/^@/, "");
  if (agentNames.has(who.toLowerCase())) return;
  const text = m.body.replace(/@locked\b/gi, " ").trim();
  // Humans can talk to Locked with a plain command ("approve C1"); an @mention is optional.
  if (!m.addressed && !COMMANDS.test(text)) return;
  console.log(`[locked] command from ${who}: ${text}`);
  const [verb, arg] = text.split(/\s+/);
  const v = (verb ?? "").toLowerCase();
  if (v === "board" || v === "") return void say(renderBoard({ ...boardInput(), now: Date.now() }));
  if (v === "approve" || v === "reject") {
    // Accept "approve C1", "approve C1, C2 and C3" or "approve all".
    const ids = /\ball\b/i.test(text)
      ? Object.values(state.contracts).filter((c) => c.state === "accepted" || c.state === "escalated").map((c) => c.id)
      : [...new Set((text.match(/\bC\d+\b/gi) ?? []).map((s) => s.toUpperCase()))];
    if (!ids.length) return void say(`Tell me which agreement, for example \`${v} C1\`.`);
    if (!isLead(who)) return void say(`Only the tech lead (${cfg.leads.join(", ")}) can ${v} shared interface changes. ${who}, I've left ${ids.join(", ")} as they are.`);
    const done: string[] = [];
    const problems: string[] = [];
    for (const id of ids) {
      const c = state.contracts[id];
      if (!c) {
        problems.push(`${id}: no such agreement`);
        continue;
      }
      try {
        saveContract(v === "approve" ? approve(c, who, true, Date.now()) : reject(c, who, true, Date.now()));
        done.push(id);
      } catch (e) {
        problems.push(`${id}: ${(e as Error).message}`);
      }
    }
    const verbPast = v === "approve" ? "approved" : "rejected";
    await say(
      [done.length ? `✅ ${who} ${verbPast} ${done.join(", ")}. Agents can now build on ${done.length === 1 ? "it" : "them"}.` : "", ...problems]
        .filter(Boolean)
        .join("\n"),
    );
    return void postBoardSoon();
  }
  if (v === "why") {
    const c = conflicts.find((x) => x.id.toLowerCase().includes((arg ?? "").toLowerCase()));
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

const devTokens = parseDevTokens(process.env.LOCKED_DEV_TOKENS);

const server = createServer(async (req, res) => {
  try {
    const caller = resolveCaller(req.headers.authorization, cfg.teamToken, devTokens);
    if (caller.kind === "none") return send(res, 401, { error: "bad token" });
    const as = (claimed?: string) => actingDev(caller, claimed, devTokens.size > 0);
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "POST" && url.pathname === "/intent") {
      const intent = await body<Intent>(req);
      intent.dev = as(intent.dev);
      const conflicts = await onIntent(intent);
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
      const c = propose({ ...b, proposer: as(b.proposer), id: nextContractId(state), at: Date.now() });
      saveContract(c);
      await announceContract(c);
      return send(res, 200, c);
    }
    if (req.method === "POST" && parts[0] === "contracts" && parts[2] === "respond") {
      const c = state.contracts[parts[1]];
      if (!c) return send(res, 404, { error: "no such agreement" });
      const b = await body<{ dev: string; answer: "accept" | "counter" | "escalate"; note?: string }>(req);
      const dev = as(b.dev);
      const next = b.answer === "escalate" ? escalate(c, dev, Date.now()) : respond(c, dev, b.answer, b.note, Date.now());
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

const host = process.env.LOCKED_HOST ?? "127.0.0.1";
server.listen(cfg.port, host, () => console.log(`[locked] engine API on ${host}:${cfg.port}, room ${cfg.roomId}`));
void refreshConflicts();
void agent.listen(onRoomMessage, [cfg.roomId]);

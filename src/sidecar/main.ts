// Locked sidecar: runs on each developer's machine as an MCP server for their coding agent.
// It reads the working tree, publishes intents to the engine, pushes a work in progress ref, and exposes the board.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { readIntent } from "../intent/extract.js";
import type { Conflict, Intent } from "../types.js";

const run = promisify(execFile);
const repoDir = process.env.LOCKED_REPO_DIR ?? process.cwd();
const engine = (process.env.LOCKED_ENGINE_URL ?? "http://127.0.0.1:7420").replace(/\/+$/, "");
const token = process.env.LOCKED_TEAM_TOKEN ?? "";
const dev = process.env.LOCKED_DEV ?? "dev";
const baseRef = process.env.LOCKED_BASE_REF ?? "origin/main";
const watchMs = Number(process.env.LOCKED_WATCH_MS ?? "15000");
let task = process.env.LOCKED_TASK;

const git = async (args: string[], env?: NodeJS.ProcessEnv) =>
  (await run("git", args, { cwd: repoDir, env: { ...process.env, ...env }, maxBuffer: 32 << 20 })).stdout.trim();

async function api<T>(method: string, path: string, data?: unknown): Promise<T> {
  const res = await fetch(`${engine}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `engine ${res.status}`);
  return json;
}

/** Snapshot the working tree (tracked and untracked) as a commit without touching the index, and push it. */
async function pushWip(branch: string): Promise<string> {
  const index = join(tmpdir(), `locked-index-${process.pid}`);
  try {
    const env = { GIT_INDEX_FILE: index };
    await git(["read-tree", "HEAD"], env);
    await git(["add", "-A"], env);
    const tree = await git(["write-tree"], env);
    const sha = await git(["commit-tree", tree, "-p", "HEAD", "-m", `locked wip ${dev}/${branch}`], {
      GIT_AUTHOR_NAME: dev, GIT_AUTHOR_EMAIL: `${dev}@locked.local`,
      GIT_COMMITTER_NAME: dev, GIT_COMMITTER_EMAIL: `${dev}@locked.local`,
    });
    const ref = `refs/locked/${dev}/${branch.replace(/[^\w.-]+/g, "-")}`;
    await git(["push", "--quiet", "--force", "origin", `${sha}:${ref}`]);
    return ref;
  } finally {
    rmSync(index, { force: true });
  }
}

async function sync(): Promise<{ intent: Intent; conflicts: Conflict[] }> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const intent = await readIntent(repoDir, baseRef, { dev, branch, task });
  intent.wipRef = await pushWip(branch).catch(() => undefined);
  const { conflicts } = await api<{ conflicts: Conflict[] }>("POST", "/intent", intent);
  return { intent, conflicts: conflicts.filter((c) => c.devs.includes(dev)) };
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const describe = (cs: Conflict[]) =>
  cs.length ? cs.map((c) => `${c.severity === "break" ? "BREAK" : "risk"} ${c.id}: ${c.summary}\n  ${c.evidence.join("\n  ")}`).join("\n") : "No conflicts with teammates right now.";

const server = new McpServer({ name: "locked", version: "0.1.0" });

server.tool(
  "locked_sync",
  "Publish what you are changing (exported symbols, signatures, call sites) to your team's Locked room and get any conflicts with teammates' in-progress work. Call after each meaningful edit and before opening a PR.",
  { task: z.string().optional().describe("One line description of your current task") },
  async ({ task: t }) => {
    if (t) task = t;
    const { intent, conflicts } = await sync();
    return text(`Synced ${intent.changedFiles.length} files, ${intent.symbols.length} symbol changes.\n${describe(conflicts)}`);
  },
);

server.tool("locked_board", "Show the team board: who is changing what, heads ups, interface agreements, last merge rehearsal.", {}, async () => {
  const b = await api<{ text: string }>("GET", "/board");
  return text(b.text);
});

server.tool("locked_conflicts", "List current conflicts between your work and teammates' work.", {}, async () => {
  return text(describe(await api<Conflict[]>("GET", `/conflicts?dev=${encodeURIComponent(dev)}`)));
});

server.tool(
  "locked_propose",
  "Propose a change to a shared interface (exported function signature, type, route, schema) before relying on it. Teammates whose code calls it must accept; shared interfaces also need the tech lead.",
  {
    symbol: z.string(),
    file: z.string(),
    before: z.string().optional(),
    after: z.string().describe("New signature, e.g. (id: string, opts?: GetUserOptions): Promise<User>"),
    reason: z.string(),
    affected: z.array(z.string()).describe("Teammates (dev names) whose code uses this symbol"),
    shared: z.boolean().default(true),
  },
  async (a) => {
    const c = await api<{ id: string; state: string }>("POST", "/contracts", { ...a, proposer: dev });
    return text(`Proposed ${c.id} (${c.state}). Wait for teammates and the tech lead before depending on it.`);
  },
);

server.tool(
  "locked_respond",
  "Accept, counter or escalate a teammate's interface proposal. If you accept, update your own code to the new interface.",
  { id: z.string(), answer: z.enum(["accept", "counter", "escalate"]), note: z.string().optional() },
  async ({ id, answer, note }) => {
    const c = await api<{ id: string; state: string }>("POST", `/contracts/${id}/respond`, { dev, answer, note });
    return text(`${c.id} is now ${c.state}.`);
  },
);

server.tool("locked_agreements", "List interface agreements and their states.", {}, async () => {
  const cs = await api<{ id: string; symbol: string; before?: string; after: string; state: string; proposer: string; affected: string[] }[]>("GET", "/contracts");
  return text(cs.length ? cs.map((c) => `${c.id} ${c.symbol}: ${c.before ?? "?"} -> ${c.after} [${c.state}] by ${c.proposer}, affects ${c.affected.join(", ") || "nobody"}`).join("\n") : "No agreements yet.");
});

// Background watch: publish automatically when the working tree changes, even if the agent forgets.
let lastHash = "";
setInterval(async () => {
  try {
    const status = await git(["status", "--porcelain=v1", "-uall"]);
    const diff = await git(["diff", "HEAD"]);
    const h = createHash("sha1").update(status + diff).digest("hex");
    if (h !== lastHash) {
      lastHash = h;
      await sync();
    }
  } catch (e) {
    console.error(`[locked] watch sync failed: ${(e as Error).message}`);
  }
}, watchMs);

await server.connect(new StdioServerTransport());
console.error(`[locked] sidecar for ${dev} on ${repoDir}, engine ${engine}`);

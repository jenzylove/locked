// Locked sidecar: runs on each developer's machine as an MCP server for their coding agent.
// It reads the working tree, publishes intents to the engine, pushes a work in progress ref, and exposes the board.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { api, cfg, describe, git, sync } from "./sync.js";
import type { Conflict } from "../types.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const server = new McpServer({ name: "locked", version: "0.1.0" });

server.tool(
  "locked_sync",
  "Publish what you are changing (exported symbols, signatures, call sites) to your team's Locked room and get any conflicts with teammates' in-progress work. Call after each meaningful edit and before opening a PR.",
  { task: z.string().optional().describe("One line description of your current task") },
  async ({ task }) => {
    if (task) cfg.task = task;
    const { intent, conflicts } = await sync();
    return text(`Synced ${intent.changedFiles.length} files, ${intent.symbols.length} symbol changes.\n${describe(conflicts)}`);
  },
);

server.tool("locked_board", "Show the team board: who is changing what, heads ups, interface agreements, last merge rehearsal.", {}, async () => {
  const b = await api<{ text: string }>("GET", "/board");
  return text(b.text);
});

server.tool("locked_conflicts", "List current conflicts between your work and teammates' work.", {}, async () => {
  return text(describe(await api<Conflict[]>("GET", `/conflicts?dev=${encodeURIComponent(cfg.dev)}`)));
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
    const c = await api<{ id: string; state: string }>("POST", "/contracts", { ...a, proposer: cfg.dev });
    return text(`Proposed ${c.id} (${c.state}). Wait for teammates and the tech lead before depending on it.`);
  },
);

server.tool(
  "locked_respond",
  "Accept, counter or escalate a teammate's interface proposal. If you accept, update your own code to the new interface.",
  { id: z.string(), answer: z.enum(["accept", "counter", "escalate"]), note: z.string().optional() },
  async ({ id, answer, note }) => {
    const c = await api<{ id: string; state: string }>("POST", `/contracts/${id}/respond`, { dev: cfg.dev, answer, note });
    return text(`${c.id} is now ${c.state}.`);
  },
);

server.tool("locked_agreements", "List interface agreements and their states.", {}, async () => {
  const cs = await api<{ id: string; symbol: string; before?: string; after: string; state: string; proposer: string; affected: string[] }[]>("GET", "/contracts");
  return text(
    cs.length
      ? cs.map((c) => `${c.id} ${c.symbol}: ${c.before ?? "?"} -> ${c.after} [${c.state}] by ${c.proposer}, affects ${c.affected.join(", ") || "nobody"}`).join("\n")
      : "No agreements yet.",
  );
});

// Background watch: publish automatically when the working tree changes, even if the agent forgets.
let lastHash = "";
setInterval(async () => {
  try {
    const h = createHash("sha1").update((await git(["status", "--porcelain=v1", "-uall"])) + (await git(["diff", "HEAD"]))).digest("hex");
    if (h !== lastHash) {
      lastHash = h;
      await sync();
    }
  } catch (e) {
    console.error(`[locked] watch sync failed: ${(e as Error).message}`);
  }
}, cfg.watchMs);

await server.connect(new StdioServerTransport());
console.error(`[locked] sidecar for ${cfg.dev} on ${cfg.repoDir}, engine ${cfg.engine}`);

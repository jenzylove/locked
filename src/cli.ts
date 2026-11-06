#!/usr/bin/env node
// locked join: wire this repo's coding agent to the team's Locked engine.
// locked register: register the engine as a Switch agent (prints its id and key once).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAgent } from "./switch/client.js";

const args = process.argv.slice(2);
const flag = (name: string, d?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};
const need = (name: string, v?: string) => {
  if (!v) {
    console.error(`missing --${name}`);
    process.exit(1);
  }
  return v;
};

const here = dirname(fileURLToPath(import.meta.url));
const sidecarEntry = existsSync(join(here, "sidecar", "main.js")) ? join(here, "sidecar", "main.js") : join(here, "sidecar", "main.ts");

if (args[0] === "join") {
  const repo = resolve(flag("repo", process.cwd())!);
  const dev = need("dev", flag("dev"));
  const engine = need("engine", flag("engine", process.env.LOCKED_ENGINE_URL));
  const token = need("token", flag("token", process.env.LOCKED_TEAM_TOKEN));
  const useTsx = sidecarEntry.endsWith(".ts");
  const server = {
    command: useTsx ? "npx" : "node",
    args: useTsx ? ["tsx", sidecarEntry] : [sidecarEntry],
    env: { LOCKED_DEV: dev, LOCKED_ENGINE_URL: engine, LOCKED_TEAM_TOKEN: token, LOCKED_REPO_DIR: repo, LOCKED_BASE_REF: flag("base", "origin/main")! },
  };
  const mcpPath = join(repo, ".mcp.json");
  const mcp = existsSync(mcpPath) ? JSON.parse(readFileSync(mcpPath, "utf8")) : { mcpServers: {} };
  mcp.mcpServers = { ...(mcp.mcpServers ?? {}), locked: server };
  writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));
  console.log(`Wrote ${mcpPath}. Claude Code in this repo now has the locked_* tools as ${dev}.`);
  console.log(`For Codex, add to ~/.codex/config.toml:\n[mcp_servers.locked]\ncommand = "${server.command}"\nargs = ${JSON.stringify(server.args)}\nenv = ${JSON.stringify(server.env).replace(/":/g, '" =').replace(/^\{/, "{ ").replace(/\}$/, " }")}`);
} else if (args[0] === "sync") {
  const { sync, describe } = await import("./sidecar/sync.js");
  const { intent, conflicts } = await sync();
  console.log(`Synced ${intent.changedFiles.length} files, ${intent.symbols.length} symbol changes.\n${describe(conflicts)}`);
} else if (args[0] === "register") {
  const r = await registerAgent({
    bridgeUrl: need("bridge", flag("bridge", process.env.SWITCH_BRIDGE_URL)),
    registrationKey: need("key", flag("key", process.env.SWITCH_REGISTRATION_KEY)),
    name: flag("name", "locked")!,
    displayName: "Locked",
    description: "Coordinates teammates' coding agents: tracks who changes what, forecasts merge breaks, runs interface agreements and merge rehearsals.",
    overwrite: args.includes("--overwrite"),
  });
  console.log(`LOCKED_AGENT_ID=${r.id}\nLOCKED_API_KEY=${r.api_key}`);
} else if (args[0] === "room") {
  // Locked creates the team room itself and brings the agents in, using its own Switch connection.
  const { SwitchAgent } = await import("./switch/client.js");
  const agent = new SwitchAgent(
    need("bridge", flag("bridge", process.env.SWITCH_BRIDGE_URL)),
    need("agent", flag("agent", process.env.LOCKED_AGENT_ID)),
    need("api-key", flag("api-key", process.env.LOCKED_API_KEY)),
    () => {},
  );
  void agent.listen(() => {});
  await agent.ready;
  const self = flag("self", "locked")!;
  const agents = [self, ...(flag("agents", "") ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== self)];
  const bridges = await agent.op<{ id: string; type: string; is_default: boolean; status: string }[]>("list_bridges", {});
  const bridge = bridges.find((b) => b.id === flag("bridge-id")) ?? bridges.find((b) => b.is_default && b.status === "active") ?? bridges[0];
  if (!bridge) throw new Error("no messaging app bridge on this Switch server");
  const room = await agent.op<{ id: string; name: string }>("create_room", {
    name: need("name", flag("name")),
    description: flag("description", "Developers and their coding agents coordinate parallel work with Locked"),
    agent_names: agents,
    bridge_id: bridge.id,
    instructions:
      flag("instructions") ??
      'Use the locked_* tools: sync when you start and after edits, and agree changes to shared code with teammates before relying on them. The tech lead approves with "approve <id>".',
  });
  console.log(`Created room ${room.name} on ${bridge.type} with ${agents.join(", ")}.\nLOCKED_ROOM_ID=${room.id}`);
  agent.stop();
  process.exit(0);
} else {
  console.log(
    [
      "usage:",
      "  locked register --bridge <url> --key <registration key> [--name locked] [--overwrite]",
      "  locked room --name <room> --agents ada,tolu [--bridge <url> --agent <id> --api-key <key>] [--instructions <text>]",
      "  locked join --dev <name> --engine <url> --token <your token> [--repo <dir>] [--base origin/main]",
      "  locked sync            publish this repo's changes to the engine once (uses LOCKED_* env)",
    ].join("\n"),
  );
}

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
} else {
  console.log("usage:\n  locked join --dev <name> --engine <url> --token <team token> [--repo <dir>] [--base origin/main]\n  locked register --bridge <url> --key <registration key> [--name locked] [--overwrite]");
}

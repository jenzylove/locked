// Shared sync logic for the sidecar and the CLI: read the working tree, push a WIP ref, publish the intent.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { readIntent } from "../intent/extract.js";
import type { Conflict, Intent } from "../types.js";

const run = promisify(execFile);

export const cfg = {
  repoDir: process.env.LOCKED_REPO_DIR ?? process.cwd(),
  engine: (process.env.LOCKED_ENGINE_URL ?? "http://127.0.0.1:7420").replace(/\/+$/, ""),
  token: process.env.LOCKED_TEAM_TOKEN ?? "",
  dev: process.env.LOCKED_DEV ?? "dev",
  baseRef: process.env.LOCKED_BASE_REF ?? "origin/main",
  watchMs: Number(process.env.LOCKED_WATCH_MS ?? "15000"),
  task: process.env.LOCKED_TASK as string | undefined,
};

export const git = async (args: string[], env?: NodeJS.ProcessEnv) =>
  (await run("git", args, { cwd: cfg.repoDir, env: { ...process.env, ...env }, maxBuffer: 32 << 20 })).stdout.trim();

export async function api<T>(method: string, path: string, data?: unknown): Promise<T> {
  const res = await fetch(`${cfg.engine}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `engine ${res.status}`);
  return json;
}

/** Snapshot the working tree (tracked and untracked) as a commit without touching the index, and push it. */
async function pushWip(branch: string): Promise<string> {
  const index = join(tmpdir(), `locked-index-${process.pid}-${Date.now()}`);
  const who = { GIT_AUTHOR_NAME: cfg.dev, GIT_AUTHOR_EMAIL: `${cfg.dev}@locked.local`, GIT_COMMITTER_NAME: cfg.dev, GIT_COMMITTER_EMAIL: `${cfg.dev}@locked.local` };
  try {
    const env = { GIT_INDEX_FILE: index };
    await git(["read-tree", "HEAD"], env);
    await git(["add", "-A"], env);
    const tree = await git(["write-tree"], env);
    const sha = await git(["commit-tree", tree, "-p", "HEAD", "-m", `locked wip ${cfg.dev}/${branch}`], who);
    const ref = `refs/locked/${cfg.dev}/${branch.replace(/[^\w.-]+/g, "-")}`;
    await git(["push", "--quiet", "--force", "origin", `${sha}:${ref}`]);
    return ref;
  } finally {
    rmSync(index, { force: true });
  }
}

export async function sync(): Promise<{ intent: Intent; conflicts: Conflict[] }> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const intent = await readIntent(cfg.repoDir, cfg.baseRef, { dev: cfg.dev, branch, task: cfg.task });
  intent.wipRef = await pushWip(branch).catch((e) => {
    console.error(`[locked] wip push failed: ${(e as Error).message}`);
    return undefined;
  });
  const { conflicts } = await api<{ conflicts: Conflict[] }>("POST", "/intent", intent);
  return { intent, conflicts: conflicts.filter((c) => c.devs.includes(cfg.dev)) };
}

export const describe = (cs: Conflict[]) =>
  cs.length
    ? cs.map((c) => `${c.severity === "break" ? "BREAK" : "risk"} ${c.id}: ${c.summary}\n  ${c.evidence.join("\n  ")}`).join("\n")
    : "No conflicts with teammates right now.";

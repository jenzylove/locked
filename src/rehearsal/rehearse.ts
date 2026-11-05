import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RehearsalResult } from "../types.js";

export interface RehearseOpts {
  repoDir: string;
  base: string;
  a: { dev: string; ref: string };
  b: { dev: string; ref: string };
  checks: string[];
  timeoutMs?: number;
  workRoot?: string;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "locked",
  GIT_AUTHOR_EMAIL: "locked@local",
  GIT_COMMITTER_NAME: "locked",
  GIT_COMMITTER_EMAIL: "locked@local",
  GIT_TERMINAL_PROMPT: "0",
};

interface GitOut {
  code: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[]): Promise<GitOut> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const c = err ? (err as { code?: unknown }).code : 0;
        resolve({ code: typeof c === "number" ? c : err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

interface RunOut {
  ok: boolean;
  output: string;
}

function runShell(cmd: string, cwd: string, timeoutMs: number): Promise<RunOut> {
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, env: process.env });
    const kill = () => {
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
      } else {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) out += `\n[locked] timed out after ${timeoutMs}ms: ${cmd}`;
      resolve({ ok: ok && !timedOut, output: out.replace(/[[0-9;]*m/g, "") });
    };
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", (e) => {
      out += `\n[locked] failed to spawn: ${e.message}`;
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });
}

function tail(s: string, n: number): string {
  return s.replace(/\r\n/g, "\n").trimEnd().split("\n").slice(-n).join("\n");
}

async function prepareDeps(repoDir: string, wt: string, timeoutMs: number): Promise<RunOut> {
  if (!fs.existsSync(path.join(wt, "package.json"))) return { ok: true, output: "" };
  const target = path.join(wt, "node_modules");
  if (fs.existsSync(target)) return { ok: true, output: "" };
  const src = path.join(repoDir, "node_modules");
  if (fs.existsSync(src)) {
    try {
      fs.symlinkSync(src, target, process.platform === "win32" ? "junction" : "dir");
      return { ok: true, output: "" };
    } catch {
      /* fall through to npm ci */
    }
  }
  return runShell("npm ci --ignore-scripts", wt, timeoutMs);
}

async function withWorktree<T>(
  opts: RehearseOpts,
  ref: string,
  fn: (wt: string) => Promise<T>,
): Promise<T> {
  const root = opts.workRoot ?? path.join(os.tmpdir(), "locked-rehearsal");
  fs.mkdirSync(root, { recursive: true });
  const wt = path.join(root, randomBytes(6).toString("hex"));
  try {
    const add = await git(opts.repoDir, ["worktree", "add", "--detach", wt, ref]);
    if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
    return await fn(wt);
  } finally {
    // drop the node_modules link first so removal never follows into the shared directory
    try {
      const nm = path.join(wt, "node_modules");
      if (fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm);
    } catch {
      /* none */
    }
    await git(opts.repoDir, ["worktree", "remove", "--force", wt]).catch(() => {});
    try {
      fs.rmSync(wt, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    await git(opts.repoDir, ["worktree", "prune"]).catch(() => {});
  }
}

async function runChecks(opts: RehearseOpts, wt: string, timeoutMs: number): Promise<RunOut> {
  const dep = await prepareDeps(opts.repoDir, wt, timeoutMs);
  if (!dep.ok) return { ok: false, output: `[locked] dependency install failed\n${dep.output}` };
  for (const c of opts.checks) {
    const r = await runShell(c, wt, timeoutMs);
    if (!r.ok) return { ok: false, output: `$ ${c}\n${r.output}` };
  }
  return { ok: true, output: "" };
}

async function aloneOk(opts: RehearseOpts, ref: string, timeoutMs: number): Promise<boolean> {
  try {
    return await withWorktree(opts, ref, async (wt) => (await runChecks(opts, wt, timeoutMs)).ok);
  } catch {
    return false;
  }
}

export async function rehearse(opts: RehearseOpts): Promise<RehearsalResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const branches: [string, string] = [opts.a.dev, opts.b.dev];

  type Mid = { kind: "conflict"; files: string[] } | { kind: "done"; ok: boolean; output: string };

  const mid = await withWorktree<Mid>(opts, opts.base, async (wt) => {
    for (const ref of [opts.a.ref, opts.b.ref]) {
      const m = await git(wt, ["merge", "--no-ff", "--no-edit", ref]);
      if (m.code !== 0) {
        const u = await git(wt, ["diff", "--name-only", "--diff-filter=U"]);
        const files = u.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
        await git(wt, ["merge", "--abort"]);
        if (files.length === 0) throw new Error(`git merge failed: ${(m.stderr || m.stdout).trim()}`);
        return { kind: "conflict", files };
      }
    }
    const r = await runChecks(opts, wt, timeoutMs);
    return { kind: "done", ok: r.ok, output: r.output };
  });

  if (mid.kind === "conflict") return { status: "text_conflict", branches, files: mid.files };
  if (mid.ok) return { status: "clean", branches, checks: opts.checks };

  const alone: [boolean, boolean] = [
    await aloneOk(opts, opts.a.ref, timeoutMs),
    await aloneOk(opts, opts.b.ref, timeoutMs),
  ];
  return { status: "fails_together", branches, output: tail(mid.output, 40), aloneOk: alone };
}

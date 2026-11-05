import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rehearse } from "./rehearse.js";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString();
const w = (dir: string, f: string, c: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), c);
};

const CHECK = [
  "const fs=require('fs'),path=require('path'),assert=require('assert');",
  "const d=path.join(__dirname,'callers');",
  "for(const f of fs.readdirSync(d)){ const r=require(path.join(d,f))(); assert.ok(r&&r.id!==undefined,f+' failed'); }",
  "console.log('ok');",
  "",
].join("\n");

describe.skipIf(!hasGit)("rehearse", () => {
  let tmp: string;
  let repo: string;
  const work = () => path.join(tmp, "work");

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locked-test-"));
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    g(repo, "init", "-q", "-b", "main");
    g(repo, "config", "core.autocrlf", "false");
    w(repo, "user.js", "exports.getUser = function (id) {\n  return { id: id };\n};\n");
    w(repo, "callers/home.js", "const { getUser } = require('../user');\nmodule.exports = () => getUser(1);\n");
    w(repo, "check.js", CHECK);
    w(repo, "doc.txt", "one\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "base");

    // A: getUser requires org, updates its caller
    g(repo, "checkout", "-q", "-b", "a");
    w(
      repo,
      "user.js",
      "exports.getUser = function (id, org) {\n  if (org === undefined) throw new Error('org required');\n  return { id: id, org: org };\n};\n",
    );
    w(repo, "callers/home.js", "const { getUser } = require('../user');\nmodule.exports = () => getUser(1, 'acme');\n");
    g(repo, "commit", "-qam", "a");

    // B: new caller with one arg
    g(repo, "checkout", "-q", "main");
    g(repo, "checkout", "-q", "-b", "b");
    w(repo, "callers/invite.js", "const { getUser } = require('../user');\nmodule.exports = () => getUser(2);\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "b");

    // C and D: same-line conflict
    g(repo, "checkout", "-q", "main");
    g(repo, "checkout", "-q", "-b", "c");
    w(repo, "doc.txt", "from c\n");
    g(repo, "commit", "-qam", "c");
    g(repo, "checkout", "-q", "main");
    g(repo, "checkout", "-q", "-b", "d");
    w(repo, "doc.txt", "from d\n");
    g(repo, "commit", "-qam", "d");

    // E: harmless extra file
    g(repo, "checkout", "-q", "main");
    g(repo, "checkout", "-q", "-b", "e");
    w(repo, "readme.md", "hi\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "e");
    g(repo, "checkout", "-q", "main");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const base = { checks: ["node check.js"], timeoutMs: 30_000 };

  it("fails_together when each branch passes alone", async () => {
    const r = await rehearse({
      repoDir: repo, base: "main", a: { dev: "ada", ref: "a" }, b: { dev: "bob", ref: "b" },
      workRoot: work(), ...base,
    });
    expect(r.status).toBe("fails_together");
    if (r.status === "fails_together") {
      expect(r.aloneOk).toEqual([true, true]);
      expect(r.branches).toEqual(["ada", "bob"]);
      expect(r.output).toMatch(/org required|failed/);
    }
    expect(fs.existsSync(work()) ? fs.readdirSync(work()) : []).toEqual([]);
    expect(g(repo, "worktree", "list").trim().split("\n").length).toBe(1);
  }, 60_000);

  it("text_conflict on same line edits", async () => {
    const r = await rehearse({
      repoDir: repo, base: "main", a: { dev: "cy", ref: "c" }, b: { dev: "di", ref: "d" },
      workRoot: work(), ...base,
    });
    expect(r).toEqual({ status: "text_conflict", branches: ["cy", "di"], files: ["doc.txt"] });
  }, 60_000);

  it("clean when branches are compatible", async () => {
    const r = await rehearse({
      repoDir: repo, base: "main", a: { dev: "ada", ref: "a" }, b: { dev: "eve", ref: "e" },
      workRoot: work(), ...base,
    });
    expect(r.status).toBe("clean");
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffIntent, readIntent } from "./extract.js";

const d = (b: string, w: string, f = "a.ts") => diffIntent(new Map([[f, b]]), new Map([[f, w]]));

describe("diffIntent symbols", () => {
  it("detects a signature change with required counts", () => {
    const r = d("export function getUser(id: string) { return id; }", "export function getUser(id: string, opts: Opts) { return id; }");
    expect(r.symbols).toEqual([
      { name: "getUser", file: "a.ts", kind: "function", change: "signature_changed", before: "(id: string)", after: "(id: string, opts: Opts)", requiredParamsBefore: 1, requiredParamsAfter: 2 },
    ]);
  });

  it("optional param keeps required count and renders return type", () => {
    const r = d("export function getUser(id: string): Promise<User> { return x; }", "export function getUser(id: string, opts?: GetUserOptions): Promise<User> { return x; }");
    const s = r.symbols[0];
    expect(s.change).toBe("signature_changed");
    expect(s.after).toBe("(id: string, opts?: GetUserOptions): Promise<User>");
    expect(s.requiredParamsBefore).toBe(1);
    expect(s.requiredParamsAfter).toBe(1);
  });

  it("defaults and rest do not count as required", () => {
    const r = d("export function f(a: number) {}", "export function f(a: number, b = 1, ...c: number[]) {}");
    expect(r.symbols[0].requiredParamsAfter).toBe(1);
  });

  it("ignores formatting-only edits", () => {
    const r = d("export function f(a: string, b: number) { return a; }", "export function f(\n  a: string,\n  b: number,\n) {\n  return a;\n}");
    expect(r.symbols).toEqual([]);
  });

  it("detects body changes", () => {
    const r = d("export function f(a: string) { return a; }", "export function f(a: string) { return a + '!'; }");
    expect(r.symbols[0]).toMatchObject({ name: "f", change: "body_changed", before: "(a: string)", after: "(a: string)" });
  });

  it("detects added and removed functions, ignores non-exported", () => {
    const r = d("export function old() {}\nfunction local() {}", "export function fresh(x: number) {}\nfunction local2() {}");
    expect(r.symbols.map((s) => [s.name, s.change])).toEqual([["old", "removed"], ["fresh", "added"]]);
  });

  it("handles exported const arrow functions", () => {
    const r = d("export const f = (a: string) => a;", "export const f = (a: string, b: number): string => a;");
    expect(r.symbols[0]).toMatchObject({ name: "f", kind: "function", change: "signature_changed", after: "(a: string, b: number): string", requiredParamsAfter: 2 });
  });

  it("handles class methods and skips private ones", () => {
    const b = "export class S { get(id: string) { return 1; } private p(x: number) {} }";
    const w = "export class S { get(id: string, n: number) { return 1; } private p(x: number, y: number) {} }";
    const r = d(b, w);
    expect(r.symbols.map((s) => [s.name, s.change])).toEqual([["S.get", "signature_changed"]]);
  });

  it("handles interface member changes", () => {
    const r = d("export interface User { id: string; name: string }", "export interface User {\n  id: string;\n  name: string;\n  email: string;\n}");
    expect(r.symbols[0]).toMatchObject({ name: "User", kind: "interface", change: "signature_changed", before: "id: string; name: string", after: "id: string; name: string; email: string" });
  });

  it("handles type aliases and enums", () => {
    const r = d("export type T = 'a' | 'b';\nexport enum E { A, B }", "export type T = 'a' | 'b' | 'c';\nexport enum E { A, B, C }");
    expect(r.symbols.map((s) => [s.name, s.kind, s.change])).toEqual([["T", "type", "signature_changed"], ["E", "enum", "signature_changed"]]);
  });

  it("follows export { a } re-exports of local declarations", () => {
    const b = "function a(x: string) {}\nexport { a };";
    const w = "function a(x: string, y: string) {}\nexport { a };";
    expect(d(b, w).symbols[0]).toMatchObject({ name: "a", change: "signature_changed", requiredParamsAfter: 2 });
    expect(d("function a() {}", "function a(x: string) {}").symbols).toEqual([]);
  });

  it("treats files only in one side as added or removed, skips non-code files", () => {
    const r = diffIntent(new Map([["gone.ts", "export const f = () => 1;"], ["x.md", "a"]]), new Map([["new.tsx", "export function C() { return null; }"], ["x.md", "b"]]));
    expect(r.symbols.map((s) => [s.name, s.file, s.change])).toEqual([["f", "gone.ts", "removed"], ["C", "new.tsx", "added"]]);
  });
});

describe("diffIntent calls", () => {
  it("records callee, line, argCount and introduced flag", () => {
    const b = "getUser(id);\nother();";
    const w = "getUser(id);\n\napi.getUser(id, opts);\nother();";
    const r = d(b, w, "web/p.ts");
    expect(r.calls).toEqual([
      { callee: "getUser", file: "web/p.ts", line: 1, argCount: 1, introduced: false },
      { callee: "getUser", file: "web/p.ts", line: 3, argCount: 2, introduced: true },
      { callee: "other", file: "web/p.ts", line: 4, argCount: 0, introduced: false },
    ]);
  });

  it("flags only the extra occurrence of a duplicated call", () => {
    const r = d("f(1);", "f(1);\nf(2);\nf(1);");
    expect(r.calls.map((c) => [c.line, c.introduced])).toEqual([[1, false], [2, true], [3, true]]);
  });

  it("marks every call in an added file as introduced and skips unchanged files", () => {
    const r = diffIntent(new Map([["same.ts", "f();"]]), new Map([["same.ts", "f();"], ["n.ts", "f(1); g();"]]));
    expect(r.calls.every((c) => c.file === "n.ts" && c.introduced)).toBe(true);
    expect(r.calls).toHaveLength(2);
  });
});

function gitOk() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("readIntent", () => {
  it.skipIf(!gitOk())("reads symbols, calls and changed files from a real repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locked-intent-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    try {
      g("init", "-q");
      g("config", "user.email", "t@example.com");
      g("config", "user.name", "t");
      g("config", "commit.gpgsign", "false");
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src/user.ts"), "export function getUser(id: string) { return id; }\n");
      writeFileSync(join(dir, "README.md"), "hi\n");
      g("add", ".");
      g("commit", "-q", "-m", "init");
      writeFileSync(join(dir, "src/user.ts"), "export function getUser(id: string, opts: object) { return id; }\n");
      writeFileSync(join(dir, "src/use.ts"), "import { getUser } from './user.js';\ngetUser('a', {});\n");
      writeFileSync(join(dir, "notes.txt"), "x");
      const intent = await readIntent(dir, "HEAD", { dev: "ada", branch: "feat", task: "t" });
      expect(intent.dev).toBe("ada");
      expect(intent.base).toMatch(/^[0-9a-f]{40}$/);
      expect(intent.changedFiles).toEqual(["notes.txt", "src/use.ts", "src/user.ts"]);
      expect(intent.symbols).toMatchObject([{ name: "getUser", file: "src/user.ts", change: "signature_changed", requiredParamsBefore: 1, requiredParamsAfter: 2 }]);
      expect(intent.calls).toEqual([{ callee: "getUser", file: "src/use.ts", line: 2, argCount: 2, introduced: true }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

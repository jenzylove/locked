import { describe, expect, it } from "vitest";
import type { Intent } from "../types.js";
import { forecast } from "./forecast.js";

const intent = (dev: string, p: Partial<Intent> = {}): Intent => ({
  dev, branch: `${dev}/work`, base: "abc", changedFiles: [], symbols: [], calls: [], updatedAt: 0, ...p,
});

const tolu = intent("Tolu", {
  changedFiles: ["api/user.ts"],
  symbols: [{ name: "getUser", file: "api/user.ts", kind: "function", change: "signature_changed",
    before: "(id: string)", after: "(id: string, opts: Options)", requiredParamsBefore: 1, requiredParamsAfter: 2 }],
});
const ada = intent("Ada", {
  changedFiles: ["web/pages/invite.ts"],
  calls: [{ callee: "getUser", file: "web/pages/invite.ts", line: 14, argCount: 1, introduced: false }],
});

describe("forecast", () => {
  it("flags a call that no longer fits the new signature", () => {
    const [c, ...rest] = forecast([tolu, ada]);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ id: "signature_break:getUser:Ada+Tolu", kind: "signature_break", severity: "break", devs: ["Ada", "Tolu"] });
    expect(c.summary).toContain("Tolu's branch changes getUser(id: string) to getUser(id: string, opts: Options)");
    expect(c.summary).toContain("Ada's code calls getUser with 1 argument in web/pages/invite.ts:14");
    expect(c.evidence).toEqual(["web/pages/invite.ts:14 calls getUser with 1 arg"]);
  });

  it("is quiet when the call still fits", () => {
    const ok = intent("Ada", { calls: [{ callee: "getUser", file: "a.ts", line: 1, argCount: 2, introduced: true }] });
    expect(forecast([tolu, ok])).toEqual([]);
  });

  it("flags too many arguments and any call to a removed symbol", () => {
    const many = intent("Ada", { calls: [{ callee: "getUser", file: "a.ts", line: 1, argCount: 3, introduced: true }] });
    expect(forecast([tolu, many])).toHaveLength(1);
    const gone = intent("Tolu", { symbols: [{ name: "old", file: "x.ts", kind: "function", change: "removed", before: "()" }] });
    const caller = intent("Ada", { calls: [{ callee: "old", file: "b.ts", line: 3, argCount: 0, introduced: false }] });
    expect(forecast([gone, caller])[0].summary).toContain("removes old()");
  });

  it("treats rest parameters as unbounded", () => {
    const v = intent("Tolu", { symbols: [{ name: "log", file: "l.ts", kind: "function", change: "signature_changed", before: "(a: string)", after: "(a: string, ...r: any[])", requiredParamsAfter: 1 }] });
    const c = intent("Ada", { calls: [{ callee: "log", file: "b.ts", line: 1, argCount: 5, introduced: false }] });
    expect(forecast([v, c])).toEqual([]);
  });

  it("counts parameters with nested types correctly", () => {
    const v = intent("Tolu", { symbols: [{ name: "f", file: "l.ts", kind: "function", change: "signature_changed", before: "()", after: "(a: Map<string, number>, cb: (x: number, y: number) => void)", requiredParamsAfter: 2 }] });
    const c = intent("Ada", { calls: [{ callee: "f", file: "b.ts", line: 1, argCount: 2, introduced: false }] });
    expect(forecast([v, c])).toEqual([]);
  });

  it("marks a different signature change on the same symbol as a break", () => {
    const other = intent("Ada", { symbols: [{ ...tolu.symbols[0], after: "(id: number)", requiredParamsAfter: 1 }] });
    const [c] = forecast([tolu, other]);
    expect(c).toMatchObject({ id: "same_symbol:getUser:Ada+Tolu", severity: "break" });
  });

  it("marks body edits on the same symbol as a risk, only within one file", () => {
    const s = (file: string) => ({ name: "f", file, kind: "function" as const, change: "body_changed" as const });
    expect(forecast([intent("A", { symbols: [s("x.ts")] }), intent("B", { symbols: [s("x.ts")] })])[0]).toMatchObject({ kind: "same_symbol", severity: "risk" });
    expect(forecast([intent("A", { symbols: [s("x.ts")] }), intent("B", { symbols: [s("y.ts")] })])).toEqual([]);
  });

  it("flags hot files and honors custom patterns", () => {
    const a = intent("A", { changedFiles: ["package.json", "src/util.ts"] });
    const b = intent("B", { changedFiles: ["package.json", "src/util.ts"] });
    expect(forecast([a, b]).map((c) => c.id)).toEqual(["hot_file:package.json:A+B"]);
    expect(forecast([a, b], { hotFiles: [/util/] }).map((c) => c.id)).toEqual(["hot_file:src/util.ts:A+B"]);
  });

  it("sorts breaks first, dedupes, and ignores a dev against themself", () => {
    const hotA = intent("Ada", { ...ada, changedFiles: ["routes.ts"] });
    const hotT = intent("Tolu", { ...tolu, changedFiles: ["routes.ts"] });
    const res = forecast([hotA, hotT, hotA]);
    expect(res.map((c) => c.severity)).toEqual(["break", "risk"]);
    expect(new Set(res.map((c) => c.id)).size).toBe(res.length);
    expect(forecast([tolu, { ...tolu }])).toEqual([]);
  });
});

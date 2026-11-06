import { describe, expect, it } from "vitest";
import { draftAgreements } from "./draft.js";
import { propose } from "../contract/contract.js";
import type { Conflict, Intent } from "../types.js";

const intent = (dev: string, extra: Partial<Intent>): Intent => ({
  dev, branch: `feat/${dev}`, base: "b", changedFiles: [], symbols: [], calls: [], updatedAt: 0, ...extra,
});
const tolu = intent("tolu", {
  symbols: [{ name: "getUser", file: "src/users/users.ts", kind: "function", change: "signature_changed", before: "(id: string)", after: "(id: string, viewer: Viewer)", requiredParamsBefore: 1, requiredParamsAfter: 2 }],
});
const ada = intent("ada", { calls: [{ callee: "getUser", file: "src/pages/invite.ts", line: 4, argCount: 1, introduced: true }] });
const brk: Conflict = { id: "signature_break:getUser:ada+tolu", kind: "signature_break", devs: ["ada", "tolu"], symbol: "getUser", summary: "", evidence: [], severity: "break" };

describe("draftAgreements", () => {
  it("drafts one agreement from the dev who changed the shape, naming the caller", () => {
    const [d, ...rest] = draftAgreements([brk], [tolu, ada], []);
    expect(rest).toHaveLength(0);
    expect(d).toMatchObject({ symbol: "getUser", proposer: "tolu", affected: ["ada"], before: "(id: string)", after: "(id: string, viewer: Viewer)", shared: true });
  });

  it("skips breaks already covered by an open agreement", () => {
    const existing = propose({ id: "C1", symbol: "getUser", file: "src/users/users.ts", proposer: "tolu", after: "(x)", reason: "r", affected: ["ada"], shared: true, at: 1 });
    expect(draftAgreements([brk], [tolu, ada], [existing])).toEqual([]);
  });

  it("ignores risks and breaks it cannot attribute", () => {
    expect(draftAgreements([{ ...brk, kind: "hot_file" }], [tolu, ada], [])).toEqual([]);
    expect(draftAgreements([brk], [ada], [])).toEqual([]);
  });
});

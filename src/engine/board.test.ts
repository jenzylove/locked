import { describe, expect, it } from "vitest";
import type { Conflict, Intent } from "../types.js";
import { propose, respond } from "../contract/contract.js";
import { renderBoard, renderConflict, renderContract } from "./board.js";

const now = 10_000_000;
const intent = (dev: string, over: Partial<Intent> = {}): Intent => ({
  dev, branch: `${dev}/work`, base: "abc", changedFiles: ["a.ts", "b.ts"], symbols: [], calls: [], updatedAt: now - 3 * 60000, ...over,
});
const conflict: Conflict = {
  id: "signature_break:getUser:Ada+Tolu", kind: "signature_break", devs: ["Ada", "Tolu"], symbol: "getUser",
  summary: "Tolu's branch changes getUser(id) to getUser(id, opts).", evidence: ["web/invite.ts:14 calls getUser with 1 arg"], severity: "break",
};
const contract = propose({ id: "k1", symbol: "getUser", file: "api/user.ts", proposer: "Tolu", before: "(id)", after: "(id, opts)",
  reason: "it needs options", affected: ["Ada", "Femi"], shared: true, at: 1 });

describe("renderBoard", () => {
  it("shows Nothing yet for every empty section", () => {
    const out = renderBoard({ repo: "acme/app", intents: [], conflicts: [], contracts: [], now });
    expect(out).toContain("**Locked board · acme/app**");
    expect(out.match(/Nothing yet\./g)).toHaveLength(4);
  });

  it("renders devs, conflicts, contracts and rehearsal", () => {
    const tolu = intent("Tolu", { task: "add options", symbols: [{ name: "getUser", file: "api/user.ts", kind: "function", change: "signature_changed" }] });
    const out = renderBoard({
      repo: "acme/app", intents: [tolu, intent("Ada")], conflicts: [conflict], contracts: [respond(contract, "Ada", "accept", undefined, 2)], now,
      lastRehearsal: { status: "fails_together", branches: ["Ada/work", "Tolu/work"], output: "ok\nTypeError: bad call at invite.ts:14", aloneOk: [true, true] },
    });
    expect(out).toContain("**Tolu** on `Tolu/work`: add options (2 files, changes getUser), updated 3 min ago");
    expect(out).toContain("🔴 Tolu's branch changes");
    expect(out).toContain("`k1` getUser (id) → (id, opts): waiting on Femi");
    expect(out).toContain("❌ Each passes alone, but Ada/work and Tolu/work fail together: TypeError: bad call at invite.ts:14");
    expect(out).not.toMatch(/—/);
  });

  it("truncates long lists and stays short", () => {
    const intents = Array.from({ length: 10 }, (_, i) => intent(`dev${i}`));
    const conflicts = Array.from({ length: 9 }, (_, i) => ({ ...conflict, id: `x${i}` }));
    const out = renderBoard({ repo: "r", intents, conflicts, contracts: [], now, lastRehearsal: { status: "clean", branches: ["a", "b"], checks: [] } });
    expect(out).toContain("+4 more");
    expect(out).toContain("+3 more");
    expect(out).toContain("✅");
    expect(out.split("\n").length).toBeLessThanOrEqual(40);
  });

  it("describes a text conflict", () => {
    const out = renderBoard({ repo: "r", intents: [], conflicts: [], contracts: [], now, lastRehearsal: { status: "text_conflict", branches: ["a", "b"], files: ["x.ts"] } });
    expect(out).toContain("❌ a and b have a text conflict in x.ts.");
  });
});

describe("one off messages", () => {
  it("renderConflict includes the id and evidence", () => {
    const out = renderConflict(conflict);
    expect(out).toContain("🔴");
    expect(out).toContain(conflict.id);
    expect(out).toContain("• web/invite.ts:14 calls getUser with 1 arg");
  });

  it("renderContract tells people how to reply", () => {
    expect(renderContract(contract)).toContain("accept or counter k1 with locked_respond");
    const accepted = respond(respond(contract, "Ada", "accept", undefined, 2), "Femi", "accept", undefined, 3);
    const out = renderContract(accepted);
    expect(out).toContain("waiting on tech lead");
  });
});

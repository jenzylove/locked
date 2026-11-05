import { describe, expect, it } from "vitest";
import { approve, escalate, propose, reject, respond } from "./contract.js";

const base = (over: Partial<Parameters<typeof propose>[0]> = {}) =>
  propose({ id: "c1", symbol: "getUser", file: "api/user.ts", proposer: "Tolu", before: "(id)", after: "(id, opts)",
    reason: "needs options", affected: ["Ada", "Femi"], shared: false, at: 1, ...over });

describe("contract", () => {
  it("starts proposed and records history", () => {
    const c = base({ shared: true });
    expect(c).toMatchObject({ state: "proposed", needsLead: true });
    expect(c.history).toHaveLength(1);
  });

  it("approves by consensus once every affected dev accepts", () => {
    let c = respond(base(), "Ada", "accept", undefined, 2);
    expect(c.state).toBe("proposed");
    c = respond(c, "Femi", "accept", undefined, 3);
    expect(c).toMatchObject({ state: "approved", approvedBy: "consensus" });
  });

  it("waits for the lead on shared interfaces", () => {
    let c = base({ shared: true });
    c = respond(respond(c, "Ada", "accept", undefined, 2), "Femi", "accept", undefined, 3);
    expect(c.state).toBe("accepted");
    expect(() => approve(c, "Ada", false, 4)).toThrow();
    expect(approve(c, "Lead", true, 4)).toMatchObject({ state: "approved", approvedBy: "Lead" });
  });

  it("counters, then recovers when the dev changes their answer", () => {
    let c = respond(base(), "Ada", "counter", "keep id first", 2);
    expect(c.state).toBe("countered");
    expect(c.responses[0].note).toBe("keep id first");
    c = respond(c, "Ada", "accept", undefined, 3);
    expect(c.state).toBe("proposed");
    c = respond(c, "Femi", "accept", undefined, 4);
    expect(c.state).toBe("approved");
  });

  it("limits who can respond", () => {
    const c = base();
    expect(() => respond(c, "Tolu", "accept", undefined, 2)).toThrow(/proposed/);
    expect(() => respond(c, "Zed", "accept", undefined, 2)).toThrow(/not affected/);
  });

  it("does not mutate the input", () => {
    const c = base();
    respond(c, "Ada", "accept", undefined, 2);
    expect(c.responses).toEqual([]);
    expect(c.history).toHaveLength(1);
  });

  it("lets the lead approve with nobody affected, and only then from proposed", () => {
    expect(approve(base({ affected: [] }), "Lead", true, 2).state).toBe("approved");
    expect(() => approve(base(), "Lead", true, 2)).toThrow();
  });

  it("rejects only by the lead", () => {
    expect(() => reject(base(), "Ada", false, 2)).toThrow();
    expect(reject(base(), "Lead", true, 2).state).toBe("rejected");
  });

  it("escalates for involved devs and then the lead can approve", () => {
    expect(() => escalate(base(), "Zed", 2)).toThrow();
    const c = escalate(base(), "Ada", 2);
    expect(c).toMatchObject({ state: "escalated", needsLead: true });
    expect(approve(c, "Lead", true, 3).state).toBe("approved");
  });

  it("blocks changes after a terminal state", () => {
    const done = reject(base(), "Lead", true, 2);
    expect(() => respond(done, "Ada", "accept", undefined, 3)).toThrow();
    expect(() => approve(done, "Lead", true, 3)).toThrow();
    expect(() => escalate(done, "Ada", 3)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { actingDev, parseDevTokens, resolveCaller } from "./auth.js";

const tokens = parseDevTokens("ada:tok-ada, tolu:tok-tolu");

describe("engine auth", () => {
  it("maps tokens to developers", () => {
    expect(resolveCaller("Bearer tok-ada", "team", tokens)).toEqual({ kind: "dev", dev: "ada" });
    expect(resolveCaller("Bearer team", "team", tokens)).toEqual({ kind: "team" });
    expect(resolveCaller("Bearer nope", "team", tokens)).toEqual({ kind: "none" });
    expect(resolveCaller(undefined, "team", tokens)).toEqual({ kind: "none" });
  });

  it("refuses a developer token speaking for someone else", () => {
    const ada = resolveCaller("Bearer tok-ada", "team", tokens);
    expect(actingDev(ada, "ada", true)).toBe("ada");
    expect(actingDev(ada, undefined, true)).toBe("ada");
    expect(() => actingDev(ada, "tolu", true)).toThrow(/belongs to ada/);
  });

  it("lets the team token write only when no developer tokens are set", () => {
    const team = resolveCaller("Bearer team", "team", tokens);
    expect(() => actingDev(team, "ada", true)).toThrow(/only read/);
    expect(actingDev(team, "ada", false)).toBe("ada");
  });
});

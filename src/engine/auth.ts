// Who is calling the engine API. With per developer tokens, a write can only speak for the developer who owns the token.
import { timingSafeEqual } from "node:crypto";

export type Caller = { kind: "team" } | { kind: "dev"; dev: string } | { kind: "none" };

/** Parses "ada:tok1,tolu:tok2" into a token to developer map. */
export function parseDevTokens(spec: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (spec ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const dev = pair.slice(0, i).trim();
    const token = pair.slice(i + 1).trim();
    if (dev && token) map.set(token, dev);
  }
  return map;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function resolveCaller(header: string | undefined, teamToken: string, devTokens: Map<string, string>): Caller {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { kind: "none" };
  for (const [t, dev] of devTokens) if (same(t, token)) return { kind: "dev", dev };
  if (teamToken && same(teamToken, token)) return { kind: "team" };
  return { kind: "none" };
}

/**
 * The developer a write is allowed to act as. With per developer tokens configured, the token decides and a
 * mismatched claim is refused; the shared team token may then only read. Without them, the claim is trusted.
 */
export function actingDev(caller: Caller, claimed: string | undefined, devTokensConfigured: boolean): string {
  if (caller.kind === "none") throw new Error("bad token");
  if (caller.kind === "dev") {
    if (claimed && claimed !== caller.dev) throw new Error(`this token belongs to ${caller.dev}, not ${claimed}`);
    return caller.dev;
  }
  if (devTokensConfigured) throw new Error("the team token can only read; use your own developer token to write");
  if (!claimed) throw new Error("missing dev");
  return claimed;
}

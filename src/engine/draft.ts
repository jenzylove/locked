// When Locked forecasts a break, it drafts the interface agreement the two agents need, so they negotiate one shape
// instead of finding out at merge time.
import type { Conflict, Contract, Intent } from "../types.js";

export interface DraftInput {
  symbol: string;
  file: string;
  proposer: string;
  before?: string;
  after: string;
  reason: string;
  affected: string[];
  shared: boolean;
}

const open = (c: Contract) => c.state !== "approved" && c.state !== "rejected";

/** Agreements to draft for new signature breaks that no open agreement already covers. */
export function draftAgreements(conflicts: Conflict[], intents: Intent[], contracts: Contract[]): DraftInput[] {
  const drafts: DraftInput[] = [];
  const covered = new Set(contracts.filter(open).flatMap((c) => c.symbol.split(/,\s*/)));
  for (const c of conflicts) {
    if (c.kind !== "signature_break" || !c.symbol || covered.has(c.symbol)) continue;
    const owner = intents.find(
      (i) => c.devs.includes(i.dev) && i.symbols.some((s) => s.name === c.symbol && (s.change === "signature_changed" || s.change === "removed")),
    );
    const change = owner?.symbols.find((s) => s.name === c.symbol);
    if (!owner || !change) continue;
    const affected = c.devs.filter((d) => d !== owner.dev);
    drafts.push({
      symbol: c.symbol,
      file: change.file,
      proposer: owner.dev,
      before: change.before,
      after: change.after ?? "(removed)",
      reason: `Drafted by Locked from ${owner.dev}'s change: ${affected.join(", ")} still calls the old shape`,
      affected,
      shared: true,
    });
    covered.add(c.symbol);
  }
  return drafts;
}

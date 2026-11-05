import type { Contract } from "../types.js";

export interface ProposeInput {
  id: string;
  symbol: string;
  file: string;
  proposer: string;
  before?: string;
  after: string;
  reason: string;
  affected: string[];
  shared: boolean;
  at: number;
}

const isTerminal = (c: Contract) => c.state === "approved" || c.state === "rejected";

function assertOpen(c: Contract) {
  if (isTerminal(c)) throw new Error(`Contract ${c.id} is already ${c.state}`);
}

function withEvent(c: Contract, patch: Partial<Contract>, at: number, by: string, event: string): Contract {
  return { ...c, ...patch, history: [...c.history, { at, by, event }] };
}

export function propose(i: ProposeInput): Contract {
  return {
    id: i.id,
    symbol: i.symbol,
    file: i.file,
    proposer: i.proposer,
    before: i.before,
    after: i.after,
    reason: i.reason,
    affected: [...i.affected],
    needsLead: i.shared,
    state: "proposed",
    responses: [],
    history: [{ at: i.at, by: i.proposer, event: `proposed ${i.symbol}${i.before ? ` ${i.before}` : ""} to ${i.after}` }],
  };
}

export function respond(c: Contract, dev: string, answer: "accept" | "counter", note: string | undefined, at: number): Contract {
  assertOpen(c);
  if (dev === c.proposer) throw new Error(`${dev} proposed ${c.id} and cannot respond to it`);
  if (!c.affected.includes(dev)) throw new Error(`${dev} is not affected by ${c.id}`);

  const responses = [...c.responses, { dev, answer, ...(note ? { note } : {}), at }];
  const latest = new Map(responses.map((r) => [r.dev, r.answer]));
  const event = `${answer === "accept" ? "accepted" : "countered"}${note ? `: ${note}` : ""}`;

  if ([...latest.values()].includes("counter")) return withEvent(c, { responses, state: "countered" }, at, dev, event);

  if (c.affected.every((d) => latest.get(d) === "accept")) {
    if (c.needsLead) return withEvent(c, { responses, state: "accepted" }, at, dev, event);
    const done = withEvent(c, { responses, state: "approved", approvedBy: "consensus" }, at, dev, event);
    return withEvent(done, {}, at, "consensus", "approved");
  }

  const state = c.state === "escalated" ? "escalated" : "proposed";
  return withEvent(c, { responses, state }, at, dev, event);
}

export function approve(c: Contract, by: string, isLead: boolean, at: number): Contract {
  assertOpen(c);
  if (!isLead) throw new Error(`${by} is not the tech lead and cannot approve ${c.id}`);
  const ready = c.state === "accepted" || c.state === "escalated" || c.affected.length === 0;
  if (!ready) throw new Error(`${c.id} is ${c.state}, so it is not ready to approve`);
  return withEvent(c, { state: "approved", approvedBy: by }, at, by, "approved");
}

export function reject(c: Contract, by: string, isLead: boolean, at: number): Contract {
  assertOpen(c);
  if (!isLead) throw new Error(`${by} is not the tech lead and cannot reject ${c.id}`);
  return withEvent(c, { state: "rejected" }, at, by, "rejected");
}

export function escalate(c: Contract, by: string, at: number): Contract {
  assertOpen(c);
  if (by !== c.proposer && !c.affected.includes(by)) throw new Error(`${by} is not part of ${c.id}`);
  return withEvent(c, { state: "escalated", needsLead: true }, at, by, "escalated to the tech lead");
}

import type { Conflict, Contract, Intent, RehearsalResult } from "../types.js";

export interface BoardState {
  repo: string;
  intents: Intent[];
  conflicts: Conflict[];
  contracts: Contract[];
  lastRehearsal?: RehearsalResult;
  now: number;
}

const MAX = { devs: 6, conflicts: 6, contracts: 5, symbols: 3 };

function capped<T>(items: T[], max: number, line: (t: T) => string): string[] {
  const lines = items.slice(0, max).map(line);
  if (items.length > max) lines.push(`+${items.length - max} more`);
  return lines.length ? lines : ["Nothing yet."];
}

function ago(then: number, now: number): string {
  const min = Math.max(0, Math.round((now - then) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}

function listNames(names: string[], max: number): string {
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max} more` : names.join(", ");
}

function intentLine(i: Intent, now: number): string {
  const names = [...new Set(i.symbols.filter((s) => s.change !== "body_changed").map((s) => s.name))];
  const files = `${i.changedFiles.length} file${i.changedFiles.length === 1 ? "" : "s"}`;
  const syms = names.length ? `, changes ${listNames(names, MAX.symbols)}` : "";
  return `• **${i.dev}** on \`${i.branch}\`${i.task ? `: ${i.task}` : ""} (${files}${syms}), updated ${ago(i.updatedAt, now)}`;
}

function waitingOn(c: Contract): string[] {
  const accepted = new Map(c.responses.map((r) => [r.dev, r.answer]));
  return c.affected.filter((d) => accepted.get(d) !== "accept");
}

export function contractStateWords(c: Contract): string {
  switch (c.state) {
    case "approved":
      return "agreed";
    case "rejected":
      return "rejected";
    case "accepted":
    case "escalated":
      return "waiting on tech lead";
    case "countered": {
      const counter = c.responses.filter((r) => r.answer === "counter").map((r) => r.dev);
      return `${listNames([...new Set(counter)], 3)} asked for a change`;
    }
    default:
      return `waiting on ${listNames(waitingOn(c), 3) || "tech lead"}`;
  }
}

const arrow = (c: Contract) => `${c.symbol} ${c.before ?? "(new)"} → ${c.after}`;

export function renderContract(c: Contract): string {
  const lines = [
    `**Interface agreement \`${c.id}\`**: ${arrow(c)}`,
    `${c.proposer} proposes this because ${c.reason}`,
    `Status: ${contractStateWords(c)}.`,
  ];
  if (c.state === "proposed" || c.state === "countered") {
    lines.push(`${listNames(waitingOn(c), 5) || "Nobody"} can accept or counter ${c.id} with locked_respond.`);
  }
  return lines.join("\n");
}

export function renderConflict(c: Conflict): string {
  const icon = c.severity === "break" ? "🔴" : "🟡";
  const lines = [`${icon} **${c.severity === "break" ? "This will break" : "Heads up"}** (${c.devs.join(" and ")}) \`${c.id}\``, c.summary];
  lines.push(...c.evidence.slice(0, 5).map((e) => `• ${e}`));
  if (c.evidence.length > 5) lines.push(`+${c.evidence.length - 5} more`);
  if (c.kind !== "hot_file" && c.severity === "break") lines.push(`The agents can agree on one shape with locked_propose.`);
  return lines.join("\n");
}

function rehearsalLine(r: RehearsalResult | undefined): string {
  if (!r) return "Nothing yet.";
  const who = r.branches.join(" and ");
  if (r.status === "clean") return `✅ ${who} merge cleanly and checks pass.`;
  if (r.status === "text_conflict") return `❌ ${who} have a text conflict in ${listNames(r.files, 3)}.`;
  const lines = r.output.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => /error|fail|✗|×/i.test(l)) ?? lines[0] ?? "no output";
  const alone = r.aloneOk.every(Boolean) ? "Each passes alone, but" : "Checks fail, and";
  return `❌ ${alone} ${who} fail together: ${first}`;
}

export function renderBoard(s: BoardState): string {
  const intents = [...s.intents].sort((a, b) => b.updatedAt - a.updatedAt);
  return [
    `**Locked board · ${s.repo}**`,
    "",
    "**Who is working on what**",
    ...capped(intents, MAX.devs, (i) => intentLine(i, s.now)),
    "",
    "**Heads up**",
    ...capped(s.conflicts, MAX.conflicts, (c) => `${c.severity === "break" ? "🔴" : "🟡"} ${c.summary} \`${c.id}\``),
    "",
    "**Interface agreements**",
    ...capped(s.contracts, MAX.contracts, (c) => `• \`${c.id}\` ${arrow(c)}: ${contractStateWords(c)}`),
    "",
    "**Last merge rehearsal**",
    rehearsalLine(s.lastRehearsal),
  ].join("\n");
}

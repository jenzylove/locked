import type { CallSite, Conflict, Intent, SymbolChange } from "../types.js";

export const DEFAULT_HOT: RegExp[] = [
  /(^|\/)(routes?|router)\b/,
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /schema|migrations?\//,
  /(^|\/)(config|settings)\.[jt]s$/,
  /(^|\/)index\.[jt]sx?$/,
];

/** Counts top level parameters of "(a: T, b?: U, ...rest)". Infinity when a rest parameter exists or the text is unreadable. */
function maxParams(sig: string | undefined): number {
  if (!sig) return Infinity;
  const start = sig.indexOf("(");
  if (start < 0) return Infinity;
  if (/\(\s*\.\.\.|,\s*\.\.\./.test(sig.slice(start))) return Infinity;
  let depth = 0;
  let count = 0;
  let sawToken = false;
  for (let i = start; i < sig.length; i++) {
    const ch = sig[i];
    if (ch === ">" && sig[i - 1] === "=") continue;
    if ("([{<".includes(ch)) {
      depth++;
      if (depth > 1) sawToken = true;
    } else if (")]}>".includes(ch)) {
      depth--;
      if (depth === 0) return sawToken ? count + 1 : count;
    } else if (ch === "," && depth === 1) {
      count++;
      sawToken = false;
    } else if (!/\s/.test(ch)) {
      sawToken = true;
    }
  }
  return Infinity;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const idOf = (kind: string, key: string, devs: [string, string]) => `${kind}:${key}:${devs.join("+")}`;
const sigText = (c: SymbolChange, which: "before" | "after") => `${c.name}${c[which] ?? "()"}`;

function callBreaks(change: SymbolChange, call: CallSite): boolean {
  if (change.change === "removed") return true;
  const min = change.requiredParamsAfter ?? 0;
  return call.argCount < min || call.argCount > maxParams(change.after);
}

function describeChange(dev: string, c: SymbolChange): string {
  return c.change === "removed"
    ? `${dev}'s branch removes ${sigText(c, "before")}.`
    : `${dev}'s branch changes ${sigText(c, "before")} to ${sigText(c, "after")}.`;
}

export function forecast(intents: Intent[], opts: { hotFiles?: RegExp[] } = {}): Conflict[] {
  const hot = opts.hotFiles ?? DEFAULT_HOT;
  const out = new Map<string, Conflict>();

  const add = (c: Conflict) => {
    const prev = out.get(c.id);
    if (!prev) return void out.set(c.id, c);
    for (const e of c.evidence) if (!prev.evidence.includes(e)) prev.evidence.push(e);
  };

  for (const a of intents) {
    for (const b of intents) {
      if (a.dev === b.dev) continue;
      for (const change of a.symbols) {
        if (change.change !== "signature_changed" && change.change !== "removed") continue;
        const bad = b.calls.filter((c) => c.callee === change.name && callBreaks(change, c));
        if (!bad.length) continue;
        const devs = pair(a.dev, b.dev);
        const first = bad[0];
        const more = bad.length > 1 ? ` and ${bad.length - 1} more place${bad.length > 2 ? "s" : ""}` : "";
        add({
          id: idOf("signature_break", change.name, devs),
          kind: "signature_break",
          devs,
          symbol: change.name,
          file: change.file,
          severity: "break",
          summary:
            `${describeChange(a.dev, change)} ${b.dev}'s code calls ${change.name} with ${plural(first.argCount, "argument")} ` +
            `in ${first.file}:${first.line}${more}. This breaks when both merge.`,
          evidence: bad.map((c) => `${c.file}:${c.line} calls ${change.name} with ${plural(c.argCount, "arg")}`),
        });
      }
    }
  }

  for (let i = 0; i < intents.length; i++) {
    for (let j = i + 1; j < intents.length; j++) {
      const a = intents[i];
      const b = intents[j];
      if (a.dev === b.dev) continue;
      const devs = pair(a.dev, b.dev);

      for (const ca of a.symbols) {
        for (const cb of b.symbols) {
          if (ca.name !== cb.name || ca.file !== cb.file) continue;
          const sigKind = (c: SymbolChange) => c.change === "signature_changed" || c.change === "removed";
          const clash = sigKind(ca) && sigKind(cb) && (ca.change !== cb.change || ca.after !== cb.after);
          add({
            id: idOf("same_symbol", ca.name, devs),
            kind: "same_symbol",
            devs,
            symbol: ca.name,
            file: ca.file,
            severity: clash ? "break" : "risk",
            summary: clash
              ? `${a.dev} and ${b.dev} both change ${ca.name} in ${ca.file}, and they change it differently. This breaks when both merge.`
              : `${a.dev} and ${b.dev} both edit ${ca.name} in ${ca.file}. Their changes may overlap when both merge.`,
            evidence: [`${a.dev}: ${ca.change} ${ca.name} in ${ca.file}`, `${b.dev}: ${cb.change} ${cb.name} in ${cb.file}`],
          });
        }
      }

      for (const f of a.changedFiles) {
        if (!b.changedFiles.includes(f) || !hot.some((re) => re.test(f))) continue;
        add({
          id: idOf("hot_file", f, devs),
          kind: "hot_file",
          devs,
          file: f,
          severity: "risk",
          summary: `${a.dev} and ${b.dev} both edit ${f}, a file that often causes merge trouble.`,
          evidence: [`${a.dev} changed ${f}`, `${b.dev} changed ${f}`],
        });
      }
    }
  }

  return [...out.values()].sort(
    (x, y) => Number(y.severity === "break") - Number(x.severity === "break") || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}

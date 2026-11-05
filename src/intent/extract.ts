import ts from "typescript";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CallSite, Intent, SymbolChange } from "../types.js";

const run = promisify(execFile);
const PARSEABLE = /\.(tsx?|jsx?|mts)$/;

interface Sym {
  kind: SymbolChange["kind"];
  sig: string;
  body: string;
  required?: number;
}

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/,\s*([)\]}>])/g, "$1").trim();
const bodyNorm = (s: string) => s.replace(/\s+/g, " ").trim();

function requiredCount(params: readonly ts.ParameterDeclaration[]): number {
  return params.filter((p) => !(ts.isIdentifier(p.name) && p.name.text === "this") && !p.questionToken && !p.initializer && !p.dotDotDotToken).length;
}

function fnSig(fn: ts.SignatureDeclaration): string {
  const tp = fn.typeParameters ? `<${fn.typeParameters.map((t) => t.getText()).join(", ")}>` : "";
  const ps = fn.parameters.map((p) => p.getText()).join(", ");
  return norm(`${tp}(${ps})${fn.type ? `: ${fn.type.getText()}` : ""}`);
}

function fnSym(fn: ts.FunctionLikeDeclaration): Sym {
  return { kind: "function", sig: fnSig(fn), body: fn.body ? bodyNorm(fn.body.getText()) : "", required: requiredCount(fn.parameters) };
}

const members = (ms: readonly ts.Node[]) => norm(ms.map((m) => m.getText().replace(/[;,]\s*$/, "")).join("; "));
const hasMod = (n: ts.Node, k: ts.SyntaxKind) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === k);
const isFnExpr = (e?: ts.Expression): e is ts.ArrowFunction | ts.FunctionExpression => !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));

function classSyms(name: string, c: ts.ClassDeclaration, out: Map<string, Sym>) {
  const heritage = (c.heritageClauses ?? []).map((h) => h.getText()).join(" ");
  const props: ts.Node[] = [];
  for (const m of c.members) {
    if (hasMod(m, ts.SyntaxKind.PrivateKeyword) || hasMod(m, ts.SyntaxKind.ProtectedKeyword)) continue;
    if (m.name && ts.isPrivateIdentifier(m.name)) continue;
    if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) {
      const mname = ts.isConstructorDeclaration(m) ? "constructor" : m.name.getText();
      out.set(`${name}.${mname}`, fnSym(m));
    } else if (ts.isPropertyDeclaration(m)) props.push(m);
  }
  out.set(name, { kind: "class", sig: norm(`${heritage} { ${members(props)} }`), body: "" });
}

type Builder = (n: string, out: Map<string, Sym>) => void;

function parseFile(path: string, content: string): Map<string, Sym> {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const locals = new Map<string, { build: Builder; exported: boolean; hasBody: boolean }>();
  const reexported = new Map<string, string>();

  const add = (name: string, exported: boolean, hasBody: boolean, build: Builder) => {
    const prev = locals.get(name);
    if (prev && prev.hasBody && !hasBody) return;
    locals.set(name, { build, exported: exported || !!prev?.exported, hasBody });
  };

  for (const st of sf.statements) {
    const exp = hasMod(st, ts.SyntaxKind.ExportKeyword);
    const dflt = hasMod(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st)) {
      add(st.name?.text ?? (dflt ? "default" : ""), exp, !!st.body, (n, out) => out.set(n, fnSym(st)));
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !isFnExpr(d.initializer)) continue;
        const init = d.initializer;
        add(d.name.text, exp, true, (n, out) => out.set(n, fnSym(init)));
      }
    } else if (ts.isClassDeclaration(st)) {
      add(st.name?.text ?? (dflt ? "default" : ""), exp, true, (n, out) => classSyms(n, st, out));
    } else if (ts.isInterfaceDeclaration(st)) {
      add(st.name.text, exp, true, (n, out) => out.set(n, { kind: "interface", sig: members(st.members), body: "" }));
    } else if (ts.isTypeAliasDeclaration(st)) {
      add(st.name.text, exp, true, (n, out) => out.set(n, { kind: "type", sig: norm(st.type.getText()), body: "" }));
    } else if (ts.isEnumDeclaration(st)) {
      add(st.name.text, exp, true, (n, out) => out.set(n, { kind: "enum", sig: members(st.members), body: "" }));
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) reexported.set(e.name.text, (e.propertyName ?? e.name).text);
    }
  }

  const out = new Map<string, Sym>();
  for (const [name, l] of locals) if (name && l.exported) l.build(name, out);
  for (const [exportedAs, local] of reexported) {
    const l = locals.get(local);
    if (!l || l.exported) continue;
    const tmp = new Map<string, Sym>();
    l.build(exportedAs, tmp);
    for (const [k, v] of tmp) out.set(k, v);
  }
  return out;
}

function diffFile(file: string, base: string | undefined, work: string | undefined): SymbolChange[] {
  const b = base === undefined ? new Map<string, Sym>() : parseFile(file, base);
  const w = work === undefined ? new Map<string, Sym>() : parseFile(file, work);
  const out: SymbolChange[] = [];
  for (const [name, s] of b) {
    const n = w.get(name);
    if (!n) {
      out.push({ name, file, kind: s.kind, change: "removed", before: s.sig, requiredParamsBefore: s.required });
    } else if (n.sig !== s.sig) {
      out.push({ name, file, kind: n.kind, change: "signature_changed", before: s.sig, after: n.sig, requiredParamsBefore: s.required, requiredParamsAfter: n.required });
    } else if (n.body !== s.body) {
      out.push({ name, file, kind: n.kind, change: "body_changed", before: s.sig, after: n.sig, requiredParamsBefore: s.required, requiredParamsAfter: n.required });
    }
  }
  for (const [name, n] of w) {
    if (!b.has(name)) out.push({ name, file, kind: n.kind, change: "added", after: n.sig, requiredParamsAfter: n.required });
  }
  return out;
}

interface RawCall {
  callee: string;
  line: number;
  argCount: number;
}

function collectCalls(file: string, content: string): RawCall[] {
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const calls: RawCall[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const callee = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined;
      if (callee) calls.push({ callee, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, argCount: n.arguments.length });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return calls;
}

function countKeys(calls: RawCall[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of calls) {
    const k = `${c.callee}/${c.argCount}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function diffCalls(file: string, base: string | undefined, work: string): CallSite[] {
  const before = countKeys(base === undefined ? [] : collectCalls(file, base));
  const workCalls = collectCalls(file, work);
  const total = countKeys(workCalls);
  const idx = new Map<string, number>();
  return workCalls.map((c) => {
    const k = `${c.callee}/${c.argCount}`;
    const i = (idx.get(k) ?? 0) + 1;
    idx.set(k, i);
    const t = total.get(k) ?? 0;
    const excess = t - (before.get(k) ?? 0);
    return { callee: c.callee, file, line: c.line, argCount: c.argCount, introduced: excess > 0 && i > t - excess };
  });
}

export function diffIntent(base: Map<string, string>, work: Map<string, string>): { symbols: SymbolChange[]; calls: CallSite[] } {
  const symbols: SymbolChange[] = [];
  const calls: CallSite[] = [];
  const files = [...new Set([...base.keys(), ...work.keys()])].filter((f) => PARSEABLE.test(f)).sort();
  for (const f of files) {
    const b = base.get(f);
    const w = work.get(f);
    if (b === w) continue;
    symbols.push(...diffFile(f, b, w));
    if (w !== undefined) calls.push(...diffCalls(f, b, w));
  }
  return { symbols, calls };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.quotepath=off", ...args], { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

const splitZ = (s: string) => s.split("\0").filter(Boolean).map((p) => p.replace(/\\/g, "/"));

export async function readIntent(repoDir: string, baseRef: string, opts: { dev: string; branch: string; task?: string }): Promise<Intent> {
  const base = (await git(repoDir, ["merge-base", baseRef, "HEAD"])).trim();
  const tracked = splitZ(await git(repoDir, ["diff", "--name-only", "-z", base]));
  const untracked = splitZ(await git(repoDir, ["ls-files", "-z", "--others", "--exclude-standard"]));
  const changedFiles = [...new Set([...tracked, ...untracked])].sort();

  const baseMap = new Map<string, string>();
  const workMap = new Map<string, string>();
  await Promise.all(
    changedFiles.filter((f) => PARSEABLE.test(f)).map(async (f) => {
      try {
        baseMap.set(f, await git(repoDir, ["show", `${base}:${f}`]));
      } catch {}
      try {
        workMap.set(f, await readFile(join(repoDir, f), "utf8"));
      } catch {}
    }),
  );

  const { symbols, calls } = diffIntent(baseMap, workMap);
  return { dev: opts.dev, branch: opts.branch, base, task: opts.task, changedFiles, symbols, calls, updatedAt: Date.now() };
}

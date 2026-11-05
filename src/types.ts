// Shared shapes between the sidecar (each developer's machine) and the engine (team server).

/** A parameter list rendered as text, e.g. "(id: string, opts?: Options)". */
export type Signature = string;

export interface SymbolChange {
  /** Exported name, e.g. "getUser" or "User". */
  name: string;
  /** Repo-relative file path using forward slashes. */
  file: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "enum";
  change: "added" | "removed" | "signature_changed" | "body_changed";
  /** Signature on the base ref, absent when added. */
  before?: Signature;
  /** Signature in the working tree, absent when removed. */
  after?: Signature;
  /** Required parameter count before and after, for call shape checks. */
  requiredParamsBefore?: number;
  requiredParamsAfter?: number;
}

export interface CallSite {
  /** Name of the function being called (imported or local identifier). */
  callee: string;
  file: string;
  line: number;
  argCount: number;
  /** True when this call is new or changed relative to the base ref. */
  introduced: boolean;
}

export interface Intent {
  dev: string;
  branch: string;
  /** Commit the branch forked from (merge-base with main). */
  base: string;
  /** Git ref where the sidecar pushed the work in progress snapshot. */
  wipRef?: string;
  task?: string;
  changedFiles: string[];
  symbols: SymbolChange[];
  calls: CallSite[];
  updatedAt: number;
}

export type ConflictKind = "signature_break" | "same_symbol" | "hot_file";

export interface Conflict {
  id: string;
  kind: ConflictKind;
  /** Developers involved. */
  devs: [string, string];
  symbol?: string;
  file?: string;
  /** Plain words, shown in the room. */
  summary: string;
  /** Evidence lines, e.g. "web/pages/invite.ts:14 calls getUser(id) with 1 arg". */
  evidence: string[];
  severity: "break" | "risk";
}

export type ContractState = "proposed" | "accepted" | "countered" | "escalated" | "approved" | "rejected";

export interface Contract {
  id: string;
  symbol: string;
  file: string;
  proposer: string;
  before?: Signature;
  after: Signature;
  reason: string;
  /** Devs whose code calls the symbol and must agree. */
  affected: string[];
  /** Whether a shared interface change needs the tech lead. */
  needsLead: boolean;
  state: ContractState;
  responses: { dev: string; answer: "accept" | "counter"; note?: string; at: number }[];
  approvedBy?: string;
  history: { at: number; by: string; event: string }[];
}

export type RehearsalResult =
  | { status: "clean"; branches: [string, string]; checks: string[] }
  | { status: "text_conflict"; branches: [string, string]; files: string[] }
  | { status: "fails_together"; branches: [string, string]; output: string; aloneOk: [boolean, boolean] };

// Engine state: intents per developer, contracts, last rehearsal. Persisted to disk so a restart keeps the room's picture.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Contract, Intent, RehearsalResult } from "../types.js";

export interface EngineState {
  repo: string;
  intents: Record<string, Intent>;
  contracts: Record<string, Contract>;
  lastRehearsal?: RehearsalResult;
  /** Conflict ids already announced, so each break is posted once. */
  announced: string[];
  boardMessageAt?: number;
  seq: number;
}

export function loadState(path: string, repo: string): EngineState {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as EngineState;
  return { repo, intents: {}, contracts: {}, announced: [], seq: 0 };
}

export function saveState(path: string, s: EngineState) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s, null, 2));
}

export function nextContractId(s: EngineState): string {
  s.seq += 1;
  return `C${s.seq}`;
}

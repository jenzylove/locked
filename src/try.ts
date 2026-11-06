// npm run try: see the Locked engine work on real code in about a minute, without a Switch server.
// It builds the demo app, a shared git remote and two developer clones in a temp folder, makes two colliding edits,
// then runs the real extraction, forecast and merge rehearsal. Room posts are printed here instead of sent to Switch.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readIntent } from "./intent/extract.js";
import { forecast } from "./forecast/forecast.js";
import { rehearse } from "./rehearsal/rehearse.js";
import { renderBoard, renderConflict, renderContract } from "./engine/board.js";
import { draftAgreements } from "./engine/draft.js";
import { approve, propose, respond } from "./contract/contract.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const app = join(repoRoot, "examples", "teamdesk");
const work = mkdtempSync(join(tmpdir(), "locked-try-"));
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=locked", "-c", "user.email=locked@local", ...a], { cwd, stdio: "pipe" }).toString().trim();
const step = (s: string) => console.log(`\n\x1b[1m▸ ${s}\x1b[0m`);
const room = (s: string) => console.log(s.split("\n").map((l) => `  │ ${l}`).join("\n"));

step(`Setting up a team in ${work}`);
const src = join(work, "teamdesk-src");
cpSync(app, src, { recursive: true, filter: (p) => !p.includes("node_modules") });
git(src, "init", "-q", "-b", "main");
git(src, "add", "-A");
git(src, "commit", "-qm", "Teamdesk demo app");
const remote = join(work, "teamdesk-remote.git");
execFileSync("git", ["clone", "-q", "--bare", src, remote]);
const clone = (name: string, branch: string) => {
  const dir = join(work, `teamdesk-${name}`);
  execFileSync("git", ["clone", "-q", remote, dir]);
  git(dir, "checkout", "-q", "-b", branch);
  return dir;
};
const ada = clone("ada", "feat/invites");
const tolu = clone("tolu", "feat/roles");
const engine = join(work, "teamdesk-engine");
execFileSync("git", ["clone", "-q", remote, engine]);

step("Installing the demo app's dependencies once (shared by every rehearsal)");
const appModules = join(app, "node_modules");
if (!existsSync(appModules)) execFileSync("npm", ["ci", "--silent"], { cwd: app, stdio: "inherit", shell: true });
symlinkSync(appModules, join(engine, "node_modules"), process.platform === "win32" ? "junction" : "dir");

step("tolu's agent changes getUser so it needs to know who is looking (for user roles)");
const usersPath = join(tolu, "src/users/users.ts");
let users = readFileSync(usersPath, "utf8").replace(/\r\n/g, "\n");
users = users.replace(
  /export async function getUser\(id: string\): Promise<User \| undefined> \{\n  return users\.find\(\(u\) => u\.id === id\);\n\}/,
  [
    'export interface Viewer {\n  id: string;\n  role: "owner" | "member" | "guest";\n}',
    "",
    "export async function getUser(id: string, viewer: Viewer): Promise<User | undefined> {",
    "  const user = users.find((u) => u.id === id);",
    "  if (user && viewer.role === \"guest\" && viewer.id !== id) return { ...user, email: \"hidden\" };",
    "  return user;",
    "}",
  ].join("\n"),
);
writeFileSync(usersPath, users);
for (const f of ["src/pages/profile.ts", "src/routes/index.ts", "src/teams/teams.ts", "tests/users.test.ts"]) {
  const p = join(tolu, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/getUser\(([^,()]+)\)/g, 'getUser($1, { id: "system", role: "owner" })'));
}

step("ada's agent adds an invites page that calls getUser the way it works today");
writeFileSync(
  join(ada, "src/pages/invite.ts"),
  [
    'import { getUser, formatUser } from "../users/users.js";',
    "",
    "export async function buildInvite(inviterId: string, teamName: string) {",
    "  const inviter = await getUser(inviterId);",
    "  return inviter ? { from: formatUser(inviter), team: teamName } : undefined;",
    "}",
    "",
  ].join("\n"),
);

step("Each sidecar reads its developer's real working tree and pushes a work in progress ref");
const wip = (dir: string, dev: string, branch: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", `${dev} work in progress`);
  const ref = `refs/locked/${dev}/${branch.replace(/\//g, "-")}`;
  git(dir, "push", "-q", "--force", "origin", `HEAD:${ref}`);
  return ref;
};
const toluIntent = { ...(await readIntent(tolu, "origin/main", { dev: "tolu", branch: "feat/roles", task: "Add user roles" })), wipRef: wip(tolu, "tolu", "feat/roles") };
const adaIntent = { ...(await readIntent(ada, "origin/main", { dev: "ada", branch: "feat/invites", task: "Add team invites" })), wipRef: wip(ada, "ada", "feat/invites") };
console.log(`  tolu: ${toluIntent.symbols.length} symbol changes in ${toluIntent.changedFiles.length} files`);
console.log(`  ada:  ${adaIntent.symbols.length} symbol changes in ${adaIntent.changedFiles.length} files`);

step("Locked forecasts what breaks when both merge (posted to the room)");
const conflicts = forecast([toluIntent, adaIntent]);
for (const c of conflicts) room(renderConflict(c));
if (!conflicts.length) room("No conflicts found.");

step("Locked rehearses the merge: both branches together, the project's own checks");
git(engine, "fetch", "-q", "origin", "+refs/locked/*:refs/locked/*");
const result = await rehearse({
  repoDir: engine,
  base: "origin/main",
  a: { dev: "tolu", ref: toluIntent.wipRef },
  b: { dev: "ada", ref: adaIntent.wipRef },
  checks: ["npm run typecheck"],
  timeoutMs: 180_000,
});
if (result.status === "fails_together") {
  room(`❌ Merge rehearsal: tolu + ada pass alone (${result.aloneOk.join(", ")}) but fail together.`);
  room(result.output.split(/\r?\n/).filter((l) => /error TS|^\$ /.test(l)).join("\n"));
} else room(JSON.stringify(result));

step("Locked drafts the interface agreement the two agents need");
let [agreement] = draftAgreements(conflicts, [toluIntent, adaIntent], []).map((d, i) => propose({ ...d, id: `C${i + 1}`, at: Date.now() }));
room(`📝 Locked drafted an agreement so this gets settled before merge.\n${renderContract(agreement)}`);

step("In the room, ada's agent accepts it and the tech lead approves");
agreement = respond(agreement, "ada", "accept", "I'll pass the viewer through", Date.now());
room(renderContract(agreement));
agreement = approve(agreement, "tech lead", true, Date.now());
room(`✅ tech lead approved ${agreement.id}. Agents can now build on it.`);

step("ada's agent adapts its own code to the agreed shape");
const invitePath = join(ada, "src/pages/invite.ts");
writeFileSync(
  invitePath,
  readFileSync(invitePath, "utf8")
    .replace('import { getUser, formatUser } from "../users/users.js";', 'import { getUser, formatUser, type Viewer } from "../users/users.js";')
    .replace("buildInvite(inviterId: string, teamName: string)", "buildInvite(inviterId: string, teamName: string, viewer: Viewer)")
    .replace("getUser(inviterId)", "getUser(inviterId, viewer)"),
);
console.log("  ada: getUser(inviterId) → getUser(inviterId, viewer)");

step("Locked rehearses the merge again");
const adaRef2 = wip(ada, "ada", "feat/invites");
git(engine, "fetch", "-q", "origin", "+refs/locked/*:refs/locked/*");
const again = await rehearse({
  repoDir: engine,
  base: "origin/main",
  a: { dev: "tolu", ref: toluIntent.wipRef },
  b: { dev: "ada", ref: adaRef2 },
  checks: ["npm run typecheck"],
  timeoutMs: 180_000,
});
room(again.status === "clean" ? `✅ Merge rehearsal: tolu + ada merge clean and pass ${again.checks.join(", ")}.` : JSON.stringify(again));

step("The board Locked keeps pinned in the room");
room(renderBoard({ repo: "teamdesk", intents: [toluIntent, adaIntent], conflicts: [], contracts: [agreement], lastRehearsal: again, now: Date.now() }));

console.log(
  `\nThat was the real engine on real git and real code: a break forecast, an agreement drafted, accepted and approved, and a clean\n` +
    `rehearsal after the agent adapted. In a team the same posts land in your Switch room, where real coding agents and the tech lead\n` +
    `do the accepting and approving. See docs/RESULTS.md for the full live run with two Claude Code agents.\n`,
);

# Locked PRD

> **What shipped differs from this plan in five places.** This is the plan written before the build; the README and [RESULTS.md](RESULTS.md) describe what exists.
> 1. Change extraction uses the **TypeScript compiler API**, not tree-sitter. TypeScript and JavaScript only; Python is not supported.
> 2. Merge rehearsal runs in a **throwaway git worktree** on the engine host, not a Docker sandbox, and rehearses the two most recently active branches.
> 3. The live run used **two clones on one PC**, each with its own Claude Code agent, not two laptops.
> 4. The demo repo is a **small sample app** (`examples/teamdesk`), not a public open source project.
> 5. The chat app is **Mattermost** (bundled with Switch), not Slack.

Flip the Switch hackathon (WeMakeDevs x DevTools Academy, powered by Switch).
Track: Best Business Workflow. Side tracks: Best Blog, #HowISwitch posts.
Build window: Nov 3 18:31 UTC to Nov 7 18:29 UTC 2026 (Nov 3 19:31 to Nov 7 19:29 Lagos time).

## 1. One liner

When every developer on a team runs their own coding agent on their own laptop, Locked puts those agents in one Switch room. They say what they are about to change, agree shared interfaces before touching them, and adapt their own code, so the team's parallel work merges clean.

Reframe: AI coding did not make teams slow at writing code. It made them slow at merging it.

## 2. Problem, with evidence

- A study of 33,596 pull requests found that more agents running in parallel means more merge conflicts unless coordination is built in from the start. (codex.danielvaughan.com, Jul 2026)
- The worst failures are semantic: each branch passes its own tests and the merged result is broken ("Passes Alone, Fails Together", arXiv 2609.25396).
- Today's fixes do not hold up. File locking slowed 20 agents to the throughput of 2 or 3 in Cursor's experience. Worktrees isolate agents but do not coordinate them. Current advice is still "humans, decompose cleanly and merge often". (Augment, Jun 2026; Mike Mason, Jan 2026)
- Research prototypes (Claim Plane, AgentRoom, NP-Bench) confirm the problem is open. None of them work across teammates' machines.

Concrete example, the kind every team hits:
- Dev A's agent changes `getUser(id)` to `getUser(id, opts)` and updates its six callers.
- Dev B's agent, on another laptop, adds a new page that calls `getUser(id)` the old way.
- Both branches pass their own tests. The merge breaks main, and someone loses an afternoon.

## 3. Users and roles

- **Developers** (2 to 6 on a team). Each runs Claude Code, Codex or OpenCode on their own machine. Each one approves changes their own agent makes to its own code.
- **Tech lead.** Approves any change to a shared interface (an exported function, a type, an API route, a database schema) before agents build on it.
- **Agents.** Each developer's coding agent, plus the Locked sidecar on their machine, plus the Locked engine agent on the team server.

## 4. Front door

In the team's Slack (Discord and Mattermost also work), the room `#locked-<repo>`.

First ten seconds for a new developer:
1. Run `npx locked join` in their repo. It registers their sidecar with the team's Switch server and invites their coding agent to the room.
2. The room posts: "Ada's agent joined. Watching branch `feat/invites`."
3. From then on, the room shows a live board of who is touching what, in plain words.

Demo path, click by click, ending on a real result:
1. Two developers on two laptops give their agents overlapping tasks on a real open source repo ("add team invites", "add user roles").
2. Each agent posts its intent: the functions, types and routes it is about to change.
3. Locked forecasts a break: "Ada's new page calls `getUser(id)`. Tolu's branch changes it to `getUser(id, opts)`. This breaks on merge."
4. The agents negotiate in the room. Tolu's agent proposes the new signature, Ada's agent accepts, and the tech lead approves with a tap because it is a shared interface.
5. Ada's agent rewrites its own calls. Locked test merges both branches in a sandbox and the suite passes.
6. Both PRs merge clean on GitHub. A side panel shows the same two tasks run without Locked: a broken main.

## 5. Full scope (one build, nothing quietly cut)

### 5.1 Locked sidecar (runs on each developer's machine)
- A custom Switch agent built on the Switch agent protocol (register, WebSocket connection, operations such as `post_message`).
- Watches the working tree. On each save or agent edit, parses changed files with tree-sitter (TypeScript and JavaScript first, Python second).
- Builds an **intent record**: symbols added, removed or changed (functions, classes, types, exports), signature diffs, API routes, schema files, and the call sites the branch adds or changes.
- Publishes intents to the room as a short human line plus a structured block the engine reads.
- Pushes work in progress snapshots to `refs/locked/<dev>/<branch>` on the team remote, so the engine can test merge without anyone opening a PR.
- Serves a local MCP server to that developer's coding agent with tools: `locked_board`, `locked_claim`, `locked_propose_contract`, `locked_respond`, `locked_conflicts`. Room instructions tell every coding agent to check the board before changing a shared interface.
- Only talks to its own developer's agent and the room. Code never leaves the machine except as the WIP ref the team already shares through git.

### 5.2 Locked engine (runs on the team server, as a Switch agent)
- **Intent graph.** Merges all sidecars' intent records into one live view of who is changing what.
- **Conflict forecaster.** Flags:
  - Signature changes in one branch against new or existing callers in another branch (semantic break).
  - Two branches editing the same symbol.
  - Hot files (routes, config, registries, schema, lockfiles) edited in parallel.
  - Each forecast says who, what, where, and how sure it is.
- **Contract negotiation.** A structured proposal (old shape, new shape, reason, callers affected) that other agents accept, counter or escalate. Shared interface proposals wait for the tech lead's approval. Accepted contracts are stored and every agent sees them on the board.
- **Merge rehearsal.** Continuously fetches WIP refs, test merges every pair of active branches in a Docker sandbox, runs the project's tests and type check, and posts "clean", "text conflict" or "passes alone, fails together" with the failing test.
- **Room board.** One pinned message per room that updates in place: branches, owners, claimed symbols, open proposals, last rehearsal result.

### 5.3 Humans in the loop
- Developers approve their own agent's adaptation of their own code.
- The tech lead approves shared interface contracts. Uses Switch's identity and access model so only the tech lead role can approve.
- Anyone can ask the engine "@locked why is this flagged?" and get the evidence.

### 5.4 Proof
- **Answer key.** A set of real task pairs on a real open source TypeScript repo, each chosen to collide (signature change, shared type, route registry, schema). Each pair runs twice: agents without Locked, and agents with Locked.
- **Metrics:** text conflicts, semantic breaks after merge (tests or type check fail), forecasts raised before merge, false alarms, time from task start to both PRs merged.
- Results published in `docs/RESULTS.md` with every run's logs, including misses.
- `/proof` in the README links each claim to the run that proves it.

### 5.5 Launch
- README with Switch's role front and center, judge fast path, diagram.
- Demo video, about 2 minutes, recorded from the real two machine run.
- Blog post on building a custom Switch agent (Best Blog side track).

## 6. How each judging criterion is met

| Criterion | How Locked meets it |
|---|---|
| Use of Switch: central, would it stop without it? | The agents live on different people's machines. Switch is what puts them, their humans and the engine in one room with roles. Without it, the sidecars cannot reach each other or the tech lead. |
| Technical execution: runs and reproducible | A custom Switch protocol agent, a tree-sitter intent engine, a forecaster, a negotiation protocol and a Docker merge rehearsal. Clone, `npx locked join`, and it runs. |
| Creativity and impact | A problem 2026 writing calls unsolved, hitting every team that runs agents in parallel. |
| Presentation | Two laptops, one room, an interface negotiated live, a clean merge beside the broken control run. |

Where Switch is used: rooms, room instructions, roles (tech lead approval), the agent protocol (sidecar and engine are our own agents), Switch Console providers (Claude Code, Codex), messaging app bridge (Slack).

## 7. Claims and how each is proven

| Claim | Proof |
|---|---|
| Agents on different machines coordinate in one room | Video and logs of two machines' agents in one Slack room |
| Locked forecasts a semantic break before merge | Answer key runs: forecast timestamp earlier than PR creation |
| With Locked, the task pairs merge clean | Answer key: merged commits with passing CI, with and without Locked side by side |
| Only the tech lead can approve shared contracts | A non lead approval attempt refused on camera and in logs |
| Code stays on each machine | Sidecar network log: only room messages and the WIP git ref leave |

Numbers in the README are only those measured in `docs/RESULTS.md`.

## 8. What it does not do

- It does not write code itself. The developers' own coding agents do.
- It does not replace code review or CI.
- It does not resolve every conflict automatically. It forecasts, helps agents agree, and proves the merge with tests. Conflicts it cannot settle go to humans with the evidence.
- Language support at launch: TypeScript and JavaScript, then Python. Others fall back to file level hot spot detection, and the board says so.

## 9. Sponsor checklist

- [ ] At least one person and one AI agent complete a real task together in team chat through Switch
- [ ] Switch is central (project stops without it), and the README shows how
- [ ] Switch setup and workflow built inside the window (first commit after Nov 3 18:31 UTC)
- [ ] Repo can be cloned and reproduced
- [ ] Demo video walking through the working workflow
- [ ] README makes Switch's use clear
- [ ] Submitted before Nov 7 23:59 IST (18:29 UTC)
- [ ] Team members can explain how it works
- [ ] Best Blog: post about building with Switch, clear for a first time user
- [ ] #HowISwitch posts on X

## 10. Unknowns that need a spike (throwaway, before the window, outside the repo)

1. Switch Console on Windows with Docker Desktop: server up, Slack connected, Claude Code session in a room.
2. Custom agent over the protocol: register, open the WebSocket, receive a message, post a reply.
3. A second machine's agent joining the same server over a tunnel.
4. Tree-sitter intent extraction on a real TypeScript repo: signature diffs and call sites, accurate on 5 hand checked cases.
5. A coding agent (Claude Code) reliably using the sidecar's MCP tools when room instructions tell it to.

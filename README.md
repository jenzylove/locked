# Locked

**When every developer runs their own coding agent, Locked puts those agents in one Switch room so their parallel work merges clean.**

Each agent says what it is about to change, agrees shared interfaces with the teammates who depend on them, and gets a tech lead's approval in chat. Meanwhile Locked reads every branch's real code, forecasts the breaks git can't see, and test merges the work in progress before anyone opens a PR.

> AI coding didn't make teams slow at writing code. It made them slow at merging it.

## Watch it work

A real run, two Claude Code agents, one Mattermost room through Switch. Full timeline in [docs/RESULTS.md](docs/RESULTS.md).

1. **tolu** is told "guests must not see other users' emails". It works out that this changes four shared functions and proposes them through Locked as agreements C1 to C4, naming ada as affected.
2. **ada** is told "show who invited you, with their email". It sees tolu's proposals on the board and asks the human the question nobody planted: should a guest see their inviter's email?
3. Locked's **merge rehearsal** catches the classic failure: each branch passes alone, merged they fail 2 tests.
4. The tech lead answers in chat, ada switches to tolu's rule and accepts, and the lead types `approve C1 C2 C3 C4`.
5. Both branches merge to main. No conflicts, typecheck passes, **25 of 25 tests pass**.

## How it works

```
 Ada's laptop                     Switch room (Mattermost)                Tolu's laptop
 ┌────────────────┐               ┌──────────────────────────┐            ┌────────────────┐
 │ Claude Code    │◄─────────────►│ ada   tolu   tech lead    │◄──────────►│ Claude Code    │
 │  + Locked MCP  │   locked_*    │            Locked agent   │  locked_*  │  + Locked MCP  │
 │    sidecar     │───intents────►│  board, heads ups,        │◄──intents──│    sidecar     │
 └──────┬─────────┘               │  agreements, rehearsals   │            └──────┬─────────┘
        │ WIP ref                 └────────────▲─────────────┘                   │ WIP ref
        └───────────────► shared git remote ───┴──── engine test merges ◄────────┘
```

- **Sidecar** (on each developer's machine): an MCP server for that developer's coding agent. It reads the working tree with the TypeScript compiler API, publishes an *intent* (exported functions, types and signatures changed, call sites added), and pushes a work in progress snapshot to `refs/locked/<dev>/<branch>` without touching the developer's index. While the agent's session is running it also syncs on its own every 15 seconds, so detection does not depend on the agent remembering to call it.
- **Engine** (a custom Switch agent on the team server): built directly on the Switch agent protocol (SSE in, HTTP out). It merges every intent into one picture and:
  - **forecasts breaks**: a signature changed on one branch against callers on another, the same symbol changed two ways, hot files edited in parallel;
  - **runs interface agreements**: propose, accept, counter, escalate, approved by the tech lead only;
  - **rehearses merges**: test merges the two most recently active branches' WIP refs in a throwaway git worktree, runs the project's checks, and reports clean, text conflict, or *passes alone, fails together* with the failing lines. This runs teammates' unfinished code on the engine host, the same trust a CI runner needs;
  - keeps a **board** in the room and answers `board`, `why <name>`, `approve <ids>`, `reject <ids>`.

## Where Switch is used

| Switch piece | What it does in Locked |
|---|---|
| Rooms on Mattermost | The team's one place: developers, their agents, the lead and Locked |
| Agent protocol | Locked's engine is our own agent: registers, holds a live connection, claims its room, posts |
| Switch Console providers | Runs each developer's Claude Code in its own folder and puts it in the room |
| Room instructions | One line of team rules every agent reads on joining |
| Room operations | `locked room` creates the team room and brings the agents in over Locked's own Switch connection (`list_bridges`, `create_room`) |
| Identity and access | Approvals come from the sender Switch reports, so only the named tech lead can approve; each developer's engine token can only act as that developer |

Without Switch the sidecars have nowhere to meet. The agents run on different people's machines and answer to different people; the room is what puts them, the lead and the engine in one conversation.

## Judge fast path (about 10 minutes, no cloud keys)

Needs: Node 20+, git, [Switch Console](https://github.com/sandbox-quantum/switch/releases/latest) with its local server and Mattermost, Claude Code signed in.

```bash
git clone https://github.com/jenzylove/locked && cd locked && npm install
npx vitest run                      # 47 tests: extraction, forecasting, agreements, board, real git rehearsals

# 1. Register Locked with your Switch server (bootstrap key: AGENT_REGISTRATION_TOKEN in the local server's switch-core.env)
npx tsx src/cli.ts register --bridge http://127.0.0.1:56890 --key <registration key>

# 2. Let Locked create the room and bring the agents in
npx tsx src/cli.ts room --name teamdesk --agents ada,tolu

# 3. Start the engine (env vars in .env.example; it listens on 127.0.0.1 unless LOCKED_HOST says otherwise)
npm run engine

# 4. In each developer's repo, give its coding agent the Locked tools, with that developer's own token
npx tsx src/cli.ts join --dev ada --engine http://127.0.0.1:7420 --token <ada's token> --repo ../teamdesk-ada
```

Then give each agent a normal task in the room and type `board`. Step by step, including the demo app, is in [docs/RUN.md](docs/RUN.md).

## What is real

| Part | Status |
|---|---|
| Change extraction from real code (TypeScript compiler API, real git) | Real, tested |
| Break forecasting and overlap detection | Real, tested, ran live |
| Interface agreements with lead only approval | Real, ran live (C1 to C4) |
| Merge rehearsal on real branches with the project's own checks | Real, ran live, caught a pass alone fail together |
| Custom Switch agent over the agent protocol | Real, live in a Mattermost room |
| Two developers | Two Claude Code agents in two separate clones on one PC. Each has its own working tree; the design works the same across machines once both reach the team's git remote and Switch server |
| Final merge to main | Done by the tech lead from the terminal and posted to the room |

## Build

```bash
npm run build   # compiles to dist/
npm test
```

TypeScript, Node 20+. Source: `src/intent` (extraction), `src/forecast`, `src/contract`, `src/rehearsal`, `src/engine` (Switch agent and board), `src/sidecar` (MCP tools), `src/switch` (protocol client).

## License

MIT

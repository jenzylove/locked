# Locked build plan

All times Lagos (UTC+1). Window opens Tue Nov 3 19:31, closes Sat Nov 7 19:29. Submit by Sat Nov 7 17:00 to leave buffer.

Overlap to manage: Origin (Meta hackathon) is due Wed Nov 4 03:00 Lagos. Locked day 1 starts after Origin is submitted.

## Phase 0. Before the window (Sun Nov 1 to Tue Nov 3)
No product code. Throwaway spikes in `~/locked-launch/spikes`, results written to `docs/spikes/`.

| Step | Done when |
|---|---|
| Docker Desktop running, Switch Console installed on Windows | `docker info` works; Console shows a local server |
| Slack workspace connected to Switch | a Claude Code session replies in a Slack room |
| Spike: custom agent over the protocol | a script registers, connects over WebSocket, and replies to an @mention |
| Spike: second machine joins | sister's laptop (or a second machine) agent replies in the same room through a tunnel |
| Spike: tree-sitter intent extraction | 5 hand checked signature changes and call sites detected correctly on the demo repo |
| Spike: coding agent uses MCP tools | Claude Code calls a dummy `locked_board` tool when room instructions say to |
| Pick the demo repo and the answer key task pairs | 6 colliding task pairs written down |

If any spike fails, stop and bring a changed plan before the window.

## Phase 1. Core logic, no network (Wed Nov 4)
| Step | Done when |
|---|---|
| Repo created (private, jenzylove), .gitignore, first commit after window opens | commit timestamp after Nov 3 18:31 UTC |
| Intent extractor (tree-sitter, TS/JS) as pure functions | unit tests pass on fixture diffs |
| Conflict forecaster as pure functions | unit tests for signature break, same symbol, hot file |
| Contract model (propose, accept, counter, escalate, approve) | unit tests for every state change |

## Phase 2. Switch integration (Wed Nov 4 to Thu Nov 5)
| Step | Done when |
|---|---|
| Sidecar as a Switch agent: watch tree, publish intents, push WIP ref | intents appear in the Slack room from a real edit |
| Sidecar MCP server for the local coding agent | Claude Code reads the board and posts a proposal through it |
| Engine as a Switch agent: intent graph, forecasts, board message | a forecast appears in the room for a real colliding edit on two machines |
| Tech lead approval through Switch roles | approval works for the lead, refused for anyone else |

## Phase 3. Merge rehearsal and the full loop (Thu Nov 5)
| Step | Done when |
|---|---|
| Docker merge rehearsal of WIP refs, tests and type check | "passes alone, fails together" caught on a seeded pair |
| Full loop on two machines: intent, forecast, negotiate, adapt, rehearse, merge | both PRs merged on GitHub with green CI |

## Phase 4. Proof (Fri Nov 6)
| Step | Done when |
|---|---|
| Answer key harness: each task pair with and without Locked | `docs/RESULTS.md` with all runs, logs, misses |
| `npx locked join` onboarding from a clean clone | a fresh machine joins in under 5 minutes |

## Phase 5. Design, audit, launch (Fri Nov 6 to Sat Nov 7)
| Step | Done when |
|---|---|
| Room board and messages polished (plain words, clear states) | screenshots of every state |
| Release readiness audit, fix findings, secret scan of history | audit report, fixes proven |
| Gate: user approves the live product | user says go |
| README, repo metadata, LICENSE | judge fast path tested on a clean clone |
| Demo video from the real two machine run | MP4 about 2 minutes |
| Blog post, X post, submission text | ready to paste |
| Submit | confirmation before Sat 17:00 |

## Risks

| Risk | Status |
|---|---|
| Switch Console on Windows is early access | needs a spike |
| Second machine reaching the local server | needs a spike (tunnel or remote host) |
| Coding agents ignoring room instructions to check the board | needs a spike; fallback is the sidecar posting forecasts directly in the agent's thread |
| Tree-sitter accuracy on real code | needs a spike; scope to TS/JS first |
| Origin deadline overlaps day 1 | known; Locked day 1 starts after Origin submits |
| Sister's laptop availability for the two machine demo | known; confirm by Nov 3 |
| Rules: setup and workflow built in the window | known; no product code before Nov 3 18:31 UTC |

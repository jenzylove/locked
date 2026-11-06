# Build log

All times Lagos (UTC+1). The build window opened Nov 3 at 19:31.

| When | Commit | What now works |
|---|---|---|
| Nov 5, 18:24 | `cdef581` | Core engine: change extraction (TypeScript compiler API), break forecasting, agreement state machine, merge rehearsal, room board, Switch protocol client, sidecar and engine agents. 44 tests. |
| Nov 5, 18:30 | `9ec3c43` | `locked sync`; forecast and *passes alone, fails together* rehearsal verified on two real clones. |
| Nov 5, 21:47 | `8249b13` | Engine claims its Switch room on connect and takes plain human commands. Live in the teamdesk Mattermost room. |
| Nov 5, 21:54 to 22:12 | | Live run with two Claude Code agents: agreements C1 to C4 proposed, accepted and approved; rehearsal caught a real break. |
| Nov 5, 22:01 and 22:06 | `95fc59b`, `0898094` | Fixes found during the run: clean room posts, overlaps on identical files ignored, several agreements approved in one message. |
| Nov 6, 07:22 | | Both branches merged to main: no conflicts, 25 of 25 tests. |
| Nov 6, 07:25 | `bd8b49c` | README, run guide, results, demo app. Repo made public. |
| Nov 6, 08:06 | `05918a2` | Audit fixes: `locked room`, per developer tokens, engine on localhost, accurate docs. |
| Nov 6, 08:29 | `9b40017` | `npm run try`: the engine on real code in under a minute, from a clean clone. |
| Nov 6, 20:08 | `b78a37b` | Locked drafts the interface agreement when it forecasts a break; `npm run try` shows break, agreement, approval and a clean rehearsal. 50 tests. |

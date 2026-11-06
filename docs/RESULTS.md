# Results

Every line here comes from a real run. Nothing is replayed or staged.

## Run 1: two Claude Code agents, one Switch room (Nov 5 2026, 21:54 to 22:12 Lagos time)

Setup: a small TypeScript app (`teamdesk`, 12 tests), a shared git remote, two clones. Each clone is one developer's agent (Claude Code, run by Switch Console): **ada** on `feat/invites`, **tolu** on `feat/roles`. Both agents and Locked sit in one Mattermost room through Switch. The human in the room is the tech lead. Both agents run on one PC; each has its own working tree and never reads the other's.

What each agent was told, and nothing more:
- tolu: "add user roles. Guests must not see other users' email addresses."
- ada: "add team invites. Add a page that shows who invited you to a team (inviter's name and email, plus the team name)."

What happened:

| Time | Event | Source |
|---|---|---|
| 21:55 | tolu syncs through Locked, works out that hiding emails changes four shared signatures, and proposes them as agreements C1 to C4, naming ada as affected | room log, engine state |
| 21:55 | ada notices on the board that its page shows the inviter's email, which overlaps tolu's rule, and says it will line up through Locked | room log |
| 21:56 | Locked flags both agents editing `src/routes/index.ts` | room log |
| 21:56 | **Merge rehearsal: pass alone, fail together.** Each branch's work in progress passed its own checks; merged, 2 tests failed (`formatUser` and `buildProfile` lost the email) | room log, throwaway git worktree run |
| 21:56 | ada asks the human a real product question nobody planted: if a guest is invited, should they see the inviter's email? | room log |
| 21:57 | tolu updates its tests; next rehearsal is green | room log |
| 22:02 | Tech lead decides: guest rule wins | room log |
| 22:04 | ada switches its page to tolu's `viewUser`, accepts C1 to C4 through Locked | room log, engine state |
| 22:10 | Tech lead types `approve C1 C2 C3 C4`; Locked marks all four agreed | room log, engine state |
| Nov 6 07:22 | Tech lead merges `feat/roles` then `feat/invites` into main: no conflicts, typecheck passes, **25 of 25 tests pass** (merge commit `e823a3f`) | git log, test output |

## Misses we found and fixed during the run

- **"approve C1, C2, C3 and C4" was read as one id.** Fixed: Locked now reads every id in the message, or `approve all`.
- **False overlap warnings after ada merged tolu's commit.** Both branches then held identical files, and Locked flagged 13 overlaps. Fixed: overlaps where both branches hold byte identical files are dropped (checked with `git rev-parse <ref>:<file>`). After the fix, 3 remained, all real (ada's extra route in the shared routes file).
- **Raw terminal colours in room posts.** Fixed: stripped, and only the failing lines are posted.
- **Agents did not act on a message that mentioned both of them at once.** The final merge was done by the tech lead from the terminal and posted to the room. Open.

## Engine tests

`npx vitest run`: 6 files, 47 tests, all passing. They cover change extraction from real git repos, break forecasting, the agreement state machine, the room board, and merge rehearsal on real git (clean, text conflict, and pass alone but fail together).

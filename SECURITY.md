# Security

Please report security problems privately through GitHub's "Report a vulnerability" on this repository, not in a public issue.

## What to know before running Locked

- **The engine runs teammates' unfinished code.** Merge rehearsal checks out other developers' work in progress and runs the project's checks on the engine host. Run the engine where you would run CI for the same repo.
- **Tokens.** `LOCKED_TEAM_TOKEN` can only read. Writes need a developer token from `LOCKED_DEV_TOKENS`, and each token can only act as its own developer. Keep them out of the repo; `.mcp.json` files written by `locked join` contain a token and should be git ignored (`locked join` users: add `.mcp.json` to `.git/info/exclude`).
- **Network.** The engine API listens on `127.0.0.1` by default. Set `LOCKED_HOST` only behind a network you trust.
- **Approvals.** Only senders named in `LOCKED_LEADS`, as reported by Switch, can approve or reject agreements.

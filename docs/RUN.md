# Run Locked end to end

This reproduces the run in [RESULTS.md](RESULTS.md) on one machine: a shared git remote, two developer clones, two Claude Code agents, Locked, and a Mattermost room through Switch.

## 1. Switch

1. Install [Switch Console](https://github.com/sandbox-quantum/switch/releases/latest) and Docker Desktop.
2. In Console, set up a server on this computer and leave Mattermost on (Admin page). The server listens on `http://127.0.0.1:56890`.
3. The local server's bootstrap registration key is `AGENT_REGISTRATION_TOKEN` in `%APPDATA%\switchdash\local-switch-server\native\run\switch-core.env` (Windows).

## 2. Demo app and clones

From the folder that contains `locked`:

```bash
cp -r locked/examples/teamdesk teamdesk-src
(cd teamdesk-src && git init -q -b main && git add -A && git commit -qm "Teamdesk demo app")
git clone -q --bare teamdesk-src teamdesk-remote.git
for d in ada tolu engine; do git clone -q teamdesk-remote.git teamdesk-$d; (cd teamdesk-$d && npm ci); done
(cd teamdesk-ada && git checkout -b feat/invites)
(cd teamdesk-tolu && git checkout -b feat/roles)
```

## 3. Register Locked and start the engine

```bash
cd locked && npm install
npx tsx src/cli.ts register --bridge http://127.0.0.1:56890 --key <AGENT_REGISTRATION_TOKEN>
# prints LOCKED_AGENT_ID and LOCKED_API_KEY
```

In Console, add agents `ada` and `tolu` first (step 4). Then let Locked create the room and bring them in:

```bash
SWITCH_BRIDGE_URL=http://127.0.0.1:56890 LOCKED_AGENT_ID=<id> LOCKED_API_KEY=<key> npx tsx src/cli.ts room --name teamdesk --agents ada,tolu
# prints LOCKED_ROOM_ID
```

Fill `.env` from `.env.example`. Pick a random `LOCKED_TEAM_TOKEN` (read only) and one token per developer in `LOCKED_DEV_TOKENS` (`ada:<token>,tolu:<token>`); each developer's token can only write as that developer. Then:

```bash
set -a; . ./.env; set +a
npm run engine
```

The log prints `connected, rooms: <room id>`.

## 4. Give each developer's agent the Locked tools

```bash
npx tsx src/cli.ts join --dev ada  --engine http://127.0.0.1:7420 --token <ada's token>  --repo ../teamdesk-ada
npx tsx src/cli.ts join --dev tolu --engine http://127.0.0.1:7420 --token <tolu's token> --repo ../teamdesk-tolu
```

This writes a `.mcp.json` in each clone. In Console, add agents `ada` and `tolu` (provider Claude Code, directory = each clone). The room instruction `locked room` sets by default, and the one used in the run:

> Use the locked_* tools: sync when you start and after edits, and agree changes to shared code with teammates before relying on them. The tech lead approves with "approve <id>".

## 5. Run it

In the room:

```
@tolu Task: add user roles. Guests must not see other users' email addresses. Work on your current branch, keep typecheck and tests passing, don't push to main.
@ada Task: add team invites. Add a page that shows who invited you to a team (inviter's name and email, plus the team name). Work on your current branch, keep typecheck and tests passing, don't push to main.
```

Then watch the board, answer the agents, and approve agreements with `approve C1 C2` (or `approve all`). Any human can type `board` or `why <name>`.

## Without Switch Console agents

`npx tsx src/cli.ts sync` in a clone (with `LOCKED_DEV`, `LOCKED_TEAM_TOKEN` set) publishes that clone's intent by hand. Two manual syncs on colliding edits are enough to see a forecast and a rehearsal in the room.

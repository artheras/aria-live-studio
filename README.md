# Aria Live Studio

**Your Twitch chat decides what gets built. Your coding agent builds it, live.**

Viewers propose features in chat (`!idea add a boss fight`), the community votes
(`!vote 2`), Aria turns the winning idea into a concrete development task, the
streamer approves it, and a coding agent (Codex, Claude Code or Aria Code)
implements it in the streamer's repository, while the whole stream watches
progress on an OBS overlay.

```
 Twitch chat ──EventSub──▶ Aria Live server ──▶ Streamer dashboard (approve / reject / cancel)
   !idea  !vote             ideas · ballot ·        │
                            task planning           ├──▶ OBS overlay (votes, task, live build progress)
                                                    │
                                                    └──▶ MCP ──▶ Codex / Claude Code / Aria Code
                                                                 claim · build · report · finish
```

| Streamer dashboard | OBS overlay (transparent, 1920 × 1080) |
|---|---|
| ![Dashboard during the vote](docs/screenshots/dashboard-voting.png) | ![Overlay ballot](docs/screenshots/overlay-voting.png) |
| ![Dashboard while Codex builds via MCP](docs/screenshots/dashboard-executing.png) | ![Overlay build progress](docs/screenshots/overlay-executing.png) |

The one thing it proves: **viewers propose → the community decides → Aria
organises the work → the streamer approves → an agent builds it → viewers see the
result.**

## Why it is safe to put on stream

- **Viewers can only suggest and vote.** Chat text never reaches a shell. A task
  runs only after the streamer approves it on the dashboard, and the streamer
  can cancel at any time.
- **Agents cannot approve.** Coding agents use a separate agent token. With it
  they can read the round, claim an approved task, report progress and finish
  the task. There is no API or tool for approving, rejecting or voting.
- **Chat assistants are read-only.** The co-host MCP URL (for ChatGPT or
  Claude.ai) only has tools that read the round, its ideas and history.
- **Viewer text is untrusted.** Ideas are sanitised (no links, no control or
  bidi characters, length limits). In every prompt they are quoted as untrusted
  data, so "ignore your instructions…" in chat is built as text, not obeyed.
- **The built-in executor is isolated.** When the streamer runs a task from the
  dashboard, it runs in a fresh git worktree on its own branch, with an
  allow-listed tool set and a timeout. It never merges or pushes. Twitch and
  session secrets are removed from its environment.
- **Real data only.** Chat arrives through the Twitch EventSub WebSocket. Local
  testing uses the official Twitch CLI mock server, never fabricated chat.

## Quick start

Requires Node.js 20.11+ (22 recommended) and a Twitch account.

1. **Register a Twitch application** at <https://dev.twitch.tv/console/apps>:
   - Name: `Aria Live Studio` (any unique name)
   - OAuth Redirect URL: `http://localhost:3000/auth/twitch/callback`
   - Category: **Chat Bot**
   - Client Type: **Confidential**

   Copy the Client ID and generate a Client Secret.
2. **Configure and run**

   ```sh
   git clone https://github.com/artheras/aria-live-studio && cd aria-live-studio
   cp .env.example .env        # fill TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET
   npm install
   npm run build
   npm start                   # http://localhost:3000
   ```

   For development with hot reload, run `npm run dev` with
   `WEB_DEV_URL=http://localhost:5173` in `.env`.
3. **Sign in** at <http://localhost:3000> with the Twitch account you stream
   from. Aria subscribes to your channel's chat (`channel.chat.message`).
4. **Add the overlay to OBS.** On the dashboard, click **Overlay URL**, then in
   OBS add a *Browser Source*, paste the URL, and set it to 1920 × 1080. The
   background is transparent.
5. **Connect your coding agent** (next section). Alternatively, set
   `ARIA_LIVE_EXECUTOR` and `TARGET_REPO` to let the dashboard run tasks itself
   in an isolated worktree.

### Planning with a model

Aria writes the task's user story, acceptance criteria, steps and risks with:

- **Claude** when `ANTHROPIC_API_KEY` is set (default `claude-opus-5-5`; override
  with `ANTHROPIC_MODEL`, and `ANTHROPIC_EFFORT`, default `medium`). The answer is
  constrained to the task schema with structured outputs, and a declined request
  is re-run server-side on Anthropic's recommended fallback model.
- **An OpenAI-compatible model** when `OPENAI_API_KEY` is set (`OPENAI_BASE_URL`,
  `ARIA_LIVE_MODEL`).
- Otherwise a deterministic **template plan**, labelled as such on the dashboard
  and overlay.

`ARIA_LIVE_PLANNER=anthropic|openai|template` forces a choice. Every plan, from
any source, is validated against the same limits before the streamer sees it,
and viewer text is always quoted as untrusted input.

## Chat commands

| Command | Who | What it does |
|---|---|---|
| `!idea <text>` | eligible chatters, while ideas are open | proposes a feature; sending the same idea again counts as a +1 |
| `!idea +<n>` or `!+1 <n>` | eligible chatters, while ideas are open | +1 idea #*n* (once per idea, not your own) |
| `!vote <n>` | eligible chatters, during the vote | votes for ballot number *n*; voting again changes your vote |
| `!ideas` | anyone | Aria replies with the current ballot or latest ideas |
| `!aria` | anyone | help (moderators also get the moderator commands) |
| `!aria open [theme]` | moderators, broadcaster | opens a round when none is running (like **Open round** / **Next round**) |
| `!aria vote` / `!aria close` | moderators, broadcaster | starts / closes the vote |
| `!aria extend <5-300>` | moderators, broadcaster | adds seconds to a timed vote |
| `!aria hide <n>` | moderators, broadcaster | hides idea #*n* while collecting, ballot #*n* while voting |

"Eligible" is set per action in **Settings** (*Who can submit ideas*, *Who can
vote*): everyone (default), subscribers (founders count), or VIPs & mods. VIPs,
moderators and the broadcaster are always eligible. Ineligible attempts are
counted on the dashboard, and each chatter is told at most once per round.
Moderator commands from anyone else are ignored silently, and the activity feed
names the moderator. Chat can never plan, approve, reject, run or cancel a
build: `!aria approve` gets "Approvals happen on the dashboard".

The streamer drives the round from the dashboard: **Open round → Start vote →
Close vote → Plan with Aria → Approve → Build → Next round.**

## Connect a coding agent (Codex · Claude Code · Aria Code)

The dashboard's **Connect a coding agent** panel shows your agent token and
ready-to-paste snippets. The agent uses five MCP tools:

| Tool | |
|---|---|
| `live_status` | round, ballot, votes, winner, task and execution state |
| `live_wait_for_task` | waits until the streamer approves the winning task |
| `live_claim_task` | claims it; the overlay now shows who is building |
| `live_report_progress` | one line per milestone, shown on stream |
| `live_complete_task` | finishes with a summary and the changed files |

The `aria-live` skill (`skills/aria-live/SKILL.md`) teaches the agent
this loop and its rules. Per-app install steps, including the co-host skill,
are in [Install in Aria Code, Claude and ChatGPT](#install-in-aria-code-claude-and-chatgpt).

**Claude Code** installs the plugin from this repository:

```sh
export ARIA_LIVE_TOKEN=<agent token>   # and ARIA_LIVE_URL if not http://localhost:3000
claude plugin marketplace add artheras/aria-live-studio
claude plugin install aria-live@aria-live-studio
```

Or add only the MCP server:
`claude mcp add aria-live -e ARIA_LIVE_TOKEN=<token> -- node /path/to/aria-live-studio/plugin/mcp/aria-live-mcp.mjs`

**Codex**: append [`plugin/codex.toml`](plugin/codex.toml) to `~/.codex/config.toml`
(fix the path and token), and copy the skill:
`cp -r skills/aria-live ~/.codex/skills/`.

**Aria Code**: `/skills add artheras/aria-live-studio`, then merge
[`plugin/mcp.json`](plugin/mcp.json) into `~/.aria-code/mcp_servers.json`
(details in [Aria Code](#aria-code) below).

**Remote (URL), no local bridge.** The server also speaks MCP over Streamable
HTTP at `PUBLIC_URL/mcp`, with the agent token as a bearer token (the panel's
**Remote (URL)** tab has the snippets):

```sh
claude mcp add --transport http aria-live http://localhost:3000/mcp --header "Authorization: Bearer <agent token>"
```

```toml
# ~/.codex/config.toml, with ARIA_LIVE_TOKEN exported in your shell
[mcp_servers.aria-live]
url = "http://localhost:3000/mcp"
bearer_token_env_var = "ARIA_LIVE_TOKEN"
tool_timeout_sec = 660
```

The Codex snippet needs a Codex version with streamable HTTP MCP support.
`/mcp` refuses a missing or wrong token (401) and a browser `Origin` other than
the app's own (403).

**Progress hook (Claude Code only).** The plugin adds a `PostToolUse` hook
(`plugin/hooks/report-progress.mjs`). While a task is claimed, it posts one line
such as "Edited boss.js", "Wrote hud.ts", "Ran tests" or "Ran a command" to the
overlay after edits and shell commands. It never sends command text or file
contents. It sends at most one line every 3 s, runs only when `ARIA_LIVE_TOKEN`
is set in your shell, and does nothing when no task is claimed. It never blocks
or fails the agent. Codex and Aria Code have no such hook: they report progress
with `live_report_progress`.

Then, in the agent, in your game's repository: *"Build what chat voted for."*

## Use ChatGPT or Claude as a co-host

Give a chat assistant the **co-host URL** (dashboard → Connect a coding agent →
Remote (URL) → Co-host). It is `PUBLIC_URL/mcp/cohost/<COHOST_KEY>` and needs no
other auth.

- **ChatGPT**: Settings → Connectors → Developer mode → Create connector →
  paste the URL, no authentication.
- **Claude.ai**: Settings → Connectors → Add custom connector → paste the URL.

It has four read-only tools: `live_status`, `live_ideas` (every visible idea
this round with ballot number, author, +1s and votes), `live_history` (recent
rounds) and `live_activity_digest` (counts and the top ideas by +1s). Use it to
summarise what chat wants, decide how to frame the vote and draft round recaps.
It **cannot** open rounds, vote, hide ideas, approve tasks or run builds. Idea
texts are marked as untrusted viewer input.

The URL must be reachable from the internet over HTTPS. For a quick tunnel, run
`cloudflared tunnel --url http://localhost:3000`, set `PUBLIC_URL` to the
tunnel URL and restart the server. **Treat the co-host URL as a secret.** It
cannot change anything, but it does show idea texts and author names. To revoke
it, set a new `COHOST_KEY`, or delete `cohostKey` from `DATA_DIR/secrets.json`
and restart.

## Install in Aria Code, Claude and ChatGPT

Two skills ship from [`skills/`](skills): **`aria-live`** (the coding agent
builds the approved task) and **`aria-live-cohost`** (a chat assistant reads
the round, summarises what chat wants, suggests how to frame the vote and
drafts recaps and posts, and never approves). Every app talks to the same
server with one of three roles. Copy each URL, key and token from the dashboard
(**Connect a coding agent**):

| Role | Endpoint | Tools |
|---|---|---|
| agent | `PUBLIC_URL/mcp` + `Authorization: Bearer <agent token>`, or the stdio bridge | wait, claim, report progress, complete, status |
| cohost | `PUBLIC_URL/mcp/cohost/<key>` | read-only: status, ideas, history, digest |
| streamer | `PUBLIC_URL/mcp/streamer/<key>` | co-host tools plus round controls. No approving, running or cancelling builds. |

| App | Install | Role and URL | What it can do |
|---|---|---|---|
| **Aria Code** | `/skills add artheras/aria-live-studio`, plus the MCP server in `mcp_servers.json` | agent, through the stdio bridge (`ARIA_LIVE_TOKEN`) | build what chat voted for. Both skills are installed and integrity-verified. |
| **Claude Code** | `claude plugin install aria-live@aria-live-studio` | agent, through the stdio bridge, or `--transport http` to `/mcp` | build, with the progress hook. The co-host skill is included. |
| **Claude Desktop** | `aria-live.mcpb` (double-click), plus optionally the skill zip | cohost (default), streamer or agent, set in the bundle's settings | co-host, round controls (streamer), or build (agent) |
| **Claude.ai / Claude mobile** | custom connector, plus upload `aria-live-cohost.zip` | co-host or streamer URL on a public HTTPS `PUBLIC_URL` | co-host from the browser. The mobile apps use the connectors and skills of your account. |
| **ChatGPT** | developer-mode connector | co-host or streamer URL on a public HTTPS `PUBLIC_URL` | co-host |
| **Codex** | [`plugin/codex.toml`](plugin/codex.toml), plus `cp -r skills/aria-live ~/.codex/skills/` | agent, through the stdio bridge, or `url` + `bearer_token_env_var` to `/mcp` | build |

Claude.ai, mobile and ChatGPT connect from the internet, so they need a public
HTTPS address for the server. See
[Hosting for ChatGPT and Claude](#hosting-for-chatgpt-and-claude). Claude
Desktop, Claude Code, Codex and Aria Code also work with `http://localhost:3000`.

### Aria Code

```text
/skills add artheras/aria-live-studio
```

This clones the repository into `~/.aria-code/skill-catalogs/artheras/aria-live-studio`
(`$ARIA_SKILL_CATALOG_HOME` overrides it) and installs `aria-live:aria-live` and
`aria-live:aria-live-cohost`. Aria Code refuses a catalog whose skills do not
match [`.claude-plugin/skills.lock.json`](.claude-plugin/skills.lock.json). Add
`--ref v0.1.0` to pin a tag. To update, delete that folder and run the command
again.

Aria Code has no `/mcp add` command. Add the server yourself: merge
[`plugin/mcp.json`](plugin/mcp.json) into the `servers` list of
`~/.aria-code/mcp_servers.json`. If you set `$ARIA_HOME`, the file is in that
folder. Older installs keep it in `~/.arthera`. Its `args` already point at the
bridge inside the installed catalog. Then:

```sh
export ARIA_LIVE_TOKEN=<agent token>   # Aria Code expands ${ARIA_LIVE_TOKEN}; edit ARIA_LIVE_URL in the file if needed
```

Run `/mcp reload`, then `/mcp tools`, which should list the five `live_*` tools.

### Claude Code

```sh
export ARIA_LIVE_TOKEN=<agent token>
claude plugin marketplace add artheras/aria-live-studio
claude plugin install aria-live@aria-live-studio
```

This installs the stdio bridge, the progress hook and both skills.

### Claude Desktop

1. Get `aria-live.mcpb`. Download it from the latest release, or from the
   **Package** workflow's artifacts, or build it with
   `node scripts/package-claude-desktop.mjs` (writes `dist/aria-live.mcpb`).
2. Double-click it, or drag it onto Settings → Extensions in Claude Desktop.
   Then fill in:
   - **Aria Live URL**: `http://localhost:3000` or your `PUBLIC_URL`. You can
     also paste the full co-host or streamer URL here.
   - **Role**: `cohost`, `streamer` or `agent`.
   - **Co-host or streamer key**: the last part of that URL.
   - **Agent token**: only for `agent`.
3. Optional: upload the `aria-live-cohost` skill, as described for Claude.ai below.

The bundle runs a small local proxy (`packages/mcp/src/proxy.ts`) that
forwards tools, resources and prompts to the server's remote MCP endpoint for
that role. It forwards annotations and `_meta` unchanged and adds no tools of
its own. A wrong key or token, or a server that is not running, shows up as a
plain error in the tool result.

### Claude.ai and the Claude mobile apps

1. **Connector**: Settings → Connectors → Add custom connector. Paste the
   co-host URL, or the streamer URL to get the round controls.
2. **Skill**: build `dist/aria-live-cohost.zip` with
   `node scripts/package-claude-skill.mjs`, or download it from the release.
   Then go to Settings → Capabilities → Skills → Upload skill. Skills need code
   execution turned on in the same settings page.
3. Ask *"summarise what chat wants"*, *"frame the vote"* or *"stream recap for
   tonight"*.

### ChatGPT

Settings → Connectors → Developer mode → Create connector. Paste the co-host
(or streamer) URL and choose no authentication. ChatGPT does not load
`SKILL.md` files. The server's own tool descriptions and instructions carry the
same rules.

### For maintainers

`skills/` is the source of truth. `plugin/skills/` is a byte-identical copy,
because Claude Code loads skills from the plugin folder. After you edit a
skill, run:

```sh
node scripts/package-skills.mjs          # validate, sync plugin/skills, rebuild skills.lock.json
node scripts/package-skills.mjs --check  # what CI runs: fails on drift or a stale lock
```

## Local end-to-end test

`scripts/e2e-local.mjs` runs the real server, the real MCP bridge and a real
browser against local stand-ins for Twitch (they live only in the script; the
product has no mock mode):

```sh
npm install
node scripts/e2e-local.mjs                  # phases A, B and C (~2 min)
node scripts/e2e-local.mjs --phases=A       # or any of A,B,C; --skip-build, --keep
```

- **A: official Twitch CLI mock.** Starts `twitch event websocket start-server
  --require-subscription` and a small fake of the Twitch auth (`/oauth2/*`) and
  Helix APIs that forwards `POST /eventsub/subscriptions` to the CLI. Logs in
  through the real OAuth redirects, checks the server connects with the CLI's
  session id and subscribes within 10 s, then drives the CLI: `close
  --reason=4006` and `keepalive --enabled=false` (reconnect with backoff and a
  new subscription), and `reconnect` (moves to the new session without
  resubscribing).
- **B: chat flow.** The CLI cannot send `channel.chat.message` (`event trigger`
  does not support it, and its subscription endpoint rejects the type, so phase
  A registers a stand-in type on the same session). Phase B therefore uses a
  minimal EventSub WebSocket server in the script that sends real-format chat
  notifications: `!idea` (duplicates, a link, emoji, too long), `!vote`
  (changes, invalid numbers), dashboard REST with CSRF (open, vote, close, plan,
  approve), then `plugin/mcp/aria-live-mcp.mjs` over stdio (wait, claim, report
  progress, complete), a cancel while an agent holds the task, and one run of
  the built-in executor with a fake `aria-code` in a temporary git repository.
- **C: screenshots.** `npm run build`, then Chromium (via `playwright-core`;
  set `CHROMIUM_PATH` if no Playwright browser is installed) saves the
  dashboard, overlay, history and login screens to `docs/screenshots/`.

Requires the [Twitch CLI](https://dev.twitch.tv/docs/cli/) for phase A (`twitch`
on `PATH`, or `--twitch-cli=PATH`).

## Development

```sh
npm test          # server, MCP and web unit/integration tests
npm run typecheck
```

| Path | |
|---|---|
| `packages/shared` | the protocol: state, REST actions, agent API types |
| `packages/server` | Twitch OAuth + EventSub, round engine, planner, executors, REST/WebSocket API |
| `packages/web` | streamer dashboard, OBS overlay, session history (React + Vite) |
| `packages/mcp` | MCP bridge for coding agents, and the stdio ↔ remote proxy for the Claude Desktop bundle |
| `skills/` | the `aria-live` and `aria-live-cohost` skills (canonical) |
| `plugin/` | Claude Code plugin (skills mirrored from `skills/`), Codex and Aria Code configs |
| `.claude-plugin/` | marketplace for Claude Code and Aria Code, and the Aria skills lock |
| `bundles/claude-desktop/` | `.mcpb` manifest. `scripts/package-*.mjs` build the bundle and the skill zips into `dist/`. |

## License

Apache-2.0

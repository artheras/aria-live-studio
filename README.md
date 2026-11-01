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
- **Chat apps never approve.** The co-host MCP URL (for ChatGPT or Claude) only
  has tools that read the round, its ideas and history. The streamer URL adds
  round control (open, vote, extend, close, hide, plan) but has no tool to
  approve, reject, run or cancel: approval happens on the dashboard.
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
   from. Aria subscribes to your channel's chat (`channel.chat.message`); see
   [Twitch integration](#twitch-integration) for the scopes it asks for.
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

**Codex** installs the same plugin from this repository (MCP server, both
skills and the progress hook):

```sh
export ARIA_LIVE_TOKEN=<agent token>   # and ARIA_LIVE_URL if not http://localhost:3000
codex plugin marketplace add artheras/aria-live-studio
codex plugin add aria-live@aria-live-studio
```

Codex asks you to review the plugin's hook before it runs. Without the hook,
the agent still reports milestones with `live_report_progress`. Without the
plugin, append [`plugin/codex.toml`](plugin/codex.toml) to
`~/.codex/config.toml` (fix the path and token) and copy the skill:
`cp -r skills/aria-live ~/.codex/skills/`.
`node scripts/check-codex-plugin.mjs` installs the plugin into a throwaway
Codex home and checks the tools, hook and skills Codex loads. CI runs it too.

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

**Progress hook (Claude Code and Codex).** The plugin adds a `PostToolUse` hook
(`plugin/hooks/report-progress.mjs`). While a task is claimed, it posts one line
such as "Edited boss.js", "Wrote hud.ts", "Ran tests" or "Ran a command" to the
overlay after edits and shell commands. It never sends command text or file
contents. It sends at most one line every 3 s, runs only when `ARIA_LIVE_TOKEN`
is set in your shell, and does nothing when no task is claimed. It never blocks
or fails the agent. In Codex it also reads `apply_patch` ("Edited game.js",
"Added pause.js and 1 more"). Aria Code has no hooks, so it reports progress
with `live_report_progress`.

Then, in the agent, in your game's repository: *"Build what chat voted for."*

## Use ChatGPT or Claude as a co-host or round assistant

The dashboard (Connect a coding agent → **Remote (URL)**) shows two connector
URLs for chat apps. Neither needs other auth; **each URL is a password**.

| URL | Role | Tools |
|---|---|---|
| `PUBLIC_URL/mcp/cohost/<COHOST_KEY>` | co-host, read-only | `live_status`, `live_ideas` (every visible idea with ballot number, author, +1s and votes), `live_history` (recent rounds), `live_activity_digest` (counts, top ideas by +1s) |
| `PUBLIC_URL/mcp/streamer/<STREAMER_KEY>` | streamer | the four read tools, plus `live_open_round {prompt?}`, `live_start_vote`, `live_extend_vote {seconds 5–300}`, `live_close_vote`, `live_hide_idea {number, hidden}` and `live_plan_task` (Aria drafts or re-drafts the task for the winner and returns it for review) |

Use the co-host to summarise what chat wants, spot duplicates, frame the vote
and draft recaps. Use the streamer URL to drive the round by voice or text
("open a round about the boss fight", "give them 30 more seconds", "close it
and plan the winner"). Its actions run the same operations as the dashboard
buttons (same rules, same errors) and show in the activity feed as
"… from the chat app". **No connector can approve, reject, run or cancel a
task: approval happens on the Aria Live dashboard.** Idea texts are marked as
untrusted viewer input in every reply.

In apps that render MCP UIs, `live_status` and the control tools show an inline
**round card** (phase, theme, ballot bars with votes and percentages, voters,
winner, task status). It is one self-contained HTML resource, served both as
an OpenAI Apps SDK template (`ui://widget/aria-live-round.html`,
`text/html+skybridge`) and as an MCP App (`ui://aria-live/round.html`,
`text/html;profile=mcp-app`). Every tool also returns structured content and a
text answer, so apps without UI support work the same.

Chat apps connect from the internet, so the server needs a public HTTPS URL:
see the next section. To revoke a URL, set a new `COHOST_KEY` / `STREAMER_KEY`,
or delete `cohostKey` / `streamerKey` from `DATA_DIR/secrets.json`, and restart.

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
| **Codex** | `codex plugin add aria-live@aria-live-studio` (or [`plugin/codex.toml`](plugin/codex.toml)) | agent, through the stdio bridge, or `url` + `bearer_token_env_var` to `/mcp` | build, with the progress hook. The co-host skill is included. |

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

## Hosting for ChatGPT and Claude

ChatGPT and Claude (web, desktop and mobile) call MCP servers from their own
cloud, so they cannot reach `localhost`. Put Aria Live behind a public HTTPS
URL, set `PUBLIC_URL` to it, and restart: the session cookie becomes `Secure`,
the Twitch OAuth redirect and every MCP URL on the dashboard use it.

**a) Quick: a tunnel from your PC.**

```sh
cloudflared tunnel --url http://localhost:3000
# prints https://<random>.trycloudflare.com
```

Set `PUBLIC_URL=https://<random>.trycloudflare.com` in `.env`, add
`https://<random>.trycloudflare.com/auth/twitch/callback` as an OAuth Redirect
URL of your Twitch application, restart `npm start`, and sign in again through
the tunnel URL. Quick tunnels get a new hostname every run; a named Cloudflare
tunnel (or any reverse proxy) keeps it stable. Everything else (OBS overlay,
local coding agents) keeps working.

**b) A small cloud deploy (Docker).** The repository has a `Dockerfile`
(non-root, port 3000, `HEALTHCHECK` on `/healthz`, state in the `/data`
volume):

```sh
docker build -t aria-live-studio .
docker run -p 3000:3000 -v aria-live-data:/data \
  -e TWITCH_CLIENT_ID=… -e TWITCH_CLIENT_SECRET=… \
  -e PUBLIC_URL=https://live.example.com -e TRUST_PROXY=1 aria-live-studio
```

Run exactly **one always-on instance with a persistent volume at `/data`**: the
Twitch EventSub WebSocket, the round and the MCP sessions live in that one
process, and `/data` holds the session, the generated secrets and the history.

- **Render**: New → Web Service from the repo (Docker), add a persistent disk
  mounted at `/data`, an instance type that does not sleep, and the env vars.
- **Fly.io**: `fly launch --no-deploy`, `fly volumes create aria_data --size 1`,
  then in `fly.toml` add `[mounts] source = "aria_data"`, `destination = "/data"`,
  and in `[http_service]` `internal_port = 3000`, `auto_stop_machines = "off"`,
  `min_machines_running = 1`; `fly secrets set TWITCH_CLIENT_SECRET=…`, `fly deploy`.
- **Cloud Run**: deploy the image with `--min-instances=1 --max-instances=1
  --no-cpu-throttling` (the WebSocket needs CPU between requests) and a volume
  mounted at `/data` (e.g. a Cloud Storage bucket).

Then set `PUBLIC_URL` to the service's `https://` URL, add
`<PUBLIC_URL>/auth/twitch/callback` to the Twitch app, and sign in. `TRUST_PROXY=1`
makes the server believe the platform's `X-Forwarded-Proto` header; leave it
unset when nothing in front of the server sets that header. In the container
the built-in executor is off: connect your coding agent from your own machine
to `PUBLIC_URL/mcp` with the agent token (see Remote (URL) above). Behind a
TLS-intercepting proxy, give npm its CA at build time with
`docker build --secret id=npm_ca,src=/path/to/ca.crt …`.

**Add the connector.** Copy the streamer or co-host URL from the dashboard
(Connect a coding agent → Remote (URL), **Reveal** to copy it in full).

- **ChatGPT**: Settings → Apps & Connectors → Advanced settings → turn on
  **Developer mode**, then Create → name it "Aria Live", paste the URL,
  authentication **No authentication**.
- **Claude**: Settings → Connectors → **Add custom connector** → paste the URL.
  On Team and Enterprise plans an owner adds it under organisation settings first.

Then ask, e.g., "What's the ballot looking like?" or "Start the vote".

**Security notes.**

- The connector URL is the password. Don't show it on stream; rotate the key if
  it leaks.
- The co-host URL is read-only. It still reveals idea texts and author names.
- The streamer URL can open rounds, run votes, hide ideas and have Aria draft a
  plan, which everyone sees on stream. It can never approve, reject, run or
  cancel a task: the streamer approves on the dashboard, signed in with Twitch.
- Only the dashboard needs your Twitch login; restrict it with
  `ALLOWED_LOGINS=<your_login>` on a public deploy.

## Twitch integration

Aria uses only the official Twitch APIs: EventSub (WebSocket) for chat and
Helix for everything it writes. At login it asks for:

| Scope | Why |
|---|---|
| `user:read:chat` | read your channel's chat (`channel.chat.message`): `!idea`, `!vote`, mod commands |
| `user:write:chat` | short, rate-limited replies in chat (and the clip link), sent as you |
| `channel:manage:broadcast` | set the stream title while a task is built, and add stream markers |
| `clips:edit` | clip the last ~30 s when a build succeeds |

What it does with them (each one can be switched off under **Settings → Twitch**):

- **Stream title.** When you approve a task, Aria reads your title
  (`GET /channels`), remembers it (it survives a server restart) and sets
  `Building live: <task title> · voted by chat` (`PATCH /channels`, trimmed to
  140 characters). When the round closes, the next round opens or you log out,
  it puts your title back, but only if Twitch still shows the one Aria set: a
  title you changed yourself in the meantime is left alone.
- **Stream markers** (`POST /streams/markers`) at round open, vote start, winner,
  build start and build end, stored on the round with the position Twitch
  reports. At round end Aria looks up your past broadcast
  (`GET /videos?type=archive`) and History shows each marker as a chip that
  opens the VOD at that moment (`…/videos/<id>?t=1h2m3s`).
- **Clip** (`POST /clips`) when a build succeeds. Twitch creates clips
  asynchronously, so Aria polls `GET /clips` for up to 15 s and only then shows
  it: a link on the dashboard and in History, "Clip saved" on the overlay, and
  `[Aria] Built live: <task> — clip: <url>` in chat when chat replies are on.

**Offline.** Markers and clips need a live broadcast. When you are offline,
Twitch refuses them; Aria writes one activity line per round ("Markers skipped:
the channel is offline", "No clip: the channel is offline") and stops trying for
that round. The title works offline too. None of this ever blocks the round:
every Twitch failure becomes an activity line, and nothing is shown unless
Twitch confirmed it.

**Reconnect banner.** A login from before these scopes keeps working (chat,
votes, builds); the extras that need a missing scope are skipped and their
toggles are disabled. The dashboard shows *Reconnect Twitch to enable stream
title, markers and clips*; the button signs you in again with Twitch's consent
screen forced (`force_verify=true`) so you can grant the new scopes. Nothing
changes in the Twitch developer console: scopes are requested at login, not
registered with the app.

**Check it on your channel before streaming.** Once you have logged in on the
dashboard:

```sh
npm run verify:twitch                    # read-only: token, scopes, channel, live state, past broadcasts
npm run verify:twitch -- --write         # also sets and restores the title, adds a marker, makes a clip
npm run verify:twitch -- --write --chat  # and posts one "[Aria] Aria Live self-test ✓" line
```

Run `--write` once while live (a test or unlisted stream is fine) and once
offline. Each check prints PASS / WARN / FAIL. For markers and clips it also
prints exactly what Twitch answered and whether Aria recognizes that answer.
The command reads `data/tokens.json` but never refreshes or rewrites it, so the
server can keep running. It saves `data/verify-twitch-report.json`, which
contains no tokens, so you can share it when something is off.

## Local end-to-end test

`scripts/e2e-local.mjs` runs the real server, the real MCP bridge and a real
browser against local stand-ins for Twitch (they live only in the script; the
product has no mock mode):

```sh
npm install
node scripts/e2e-local.mjs                  # phases A, B and C (~2 min)
node scripts/e2e-local.mjs --phases=A       # or any of A,B,C; --skip-build, --keep
node scripts/e2e-local.mjs --phases=R       # opt-in: a real Claude Code agent (~2-5 min)
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
  progress, complete), a cancel while an agent holds the task, one run of
  the built-in executor with a fake `aria-code` in a temporary git repository,
  and a round driven through the streamer MCP URL (open, vote, extend, close,
  plan; no approve tool; the round card resources; the co-host still cannot
  control anything). The fake Helix also simulates a live channel, so phase B
  checks the stream title is set and restored, the markers, the clip (chat,
  overlay, history), the VOD deep links, and an offline round.
- **C: screenshots.** `npm run build`, then Chromium (via `playwright-core`;
  set `CHROMIUM_PATH` if no Playwright browser is installed) saves the
  dashboard, overlay, history and login screens to `docs/screenshots/`.

- **R: a real agent (opt-in).** Needs the `claude` CLI, signed in. It runs a
  round on the fake Twitch (ideas, votes, plan, approve), then starts `claude
  -p` with `--plugin-dir plugin` in a small git repository. Claude Code has
  to wait for the task, claim it, implement it, report progress (its own
  `live_report_progress` calls plus the plugin's hook) and complete it. The
  phase then checks the round finished as succeeded under "Claude Code", the
  overlay got the steps and the repository changed without a commit.
  `--agent-timeout=SECONDS` (default 420).

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
| `plugin/` | One plugin for Claude Code (`.claude-plugin/`, `.mcp.json`) and Codex (`.codex-plugin/`, `codex.mcp.json`): MCP bridge, progress hook, skills mirrored from `skills/`; plus `codex.toml` and the Aria Code `mcp.json` |
| `.claude-plugin/` | marketplace for Claude Code, Codex and Aria Code, and the Aria skills lock |
| `bundles/claude-desktop/` | `.mcpb` manifest. `scripts/package-*.mjs` build the bundle and the skill zips into `dist/`. |

## Roadmap

- **Twitch Extension panel**: click-to-vote on a panel or overlay extension
  instead of typing `!vote`, starting as a Hosted Test, then Twitch review.
- **Channel Points boosts** (Affiliate and Partner channels): redeem points to
  +1 an idea or add weight to a vote, through EventSub
  `channel.channel_points_custom_reward_redemption.add`.
- **Dedicated bot account**: replies from a separate bot user with
  `user:bot` / `channel:bot`, so chat replies are not sent as the streamer.
- **Stream events on the overlay**: raids, follows and subs celebrated on the
  overlay; open a round automatically on `stream.online`.
- **More channels through a channel-agnostic Live Collaboration Runtime**: the
  round engine already knows nothing about Twitch; adapters for YouTube Live and
  Bilibili chat, Feishu and Slack for team rounds, and research reviews where a
  group votes on what an agent investigates next.

## License

Apache-2.0

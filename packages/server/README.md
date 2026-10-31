# @aria-live/server

Node 22 + TypeScript (run with `tsx`), `node:http` + `ws`. Owns all state; the
dashboard and the OBS overlay render snapshots pushed over `/ws`.

```
npm run dev --workspace @aria-live/server     # tsx watch, reads ../../.env if present
npm run start --workspace @aria-live/server
npm test --workspace @aria-live/server        # vitest
npx tsc --noEmit -p packages/server
```

Without `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` the server still starts;
`GET /api/me` reports `configured: false`.

## Layout

| path | what |
| --- | --- |
| `src/config.ts` | `Config` from env; secrets (session, overlay key, agent token) generated into `DATA_DIR/secrets.json` (0600) |
| `src/twitch/auth.ts` | OAuth code flow, state store, signed `aria_session` cookie, `tokens.json`, refresh, hourly validate |
| `src/twitch/helix.ts` | Helix client (users, EventSub subscriptions, chat messages) |
| `src/twitch/eventsub.ts` | EventSub WebSocket client (`channel.chat.message` v1) |
| `src/live/engine.ts` | pure round state machine |
| `src/live/commands.ts` | chat command parser |
| `src/live/service.ts` | wiring: chat → engine, replies, planner, executor |
| `src/live/agent.ts` | coding-agent bridge (`/api/agent/*`) |
| `src/live/store.ts` | `state.json` (debounced, atomic) + `history.jsonl` |
| `src/http/server.ts`, `ws.ts`, `redact.ts` | REST, static files, WebSocket hub, overlay redaction |

## Vote numbers

`Idea.number` is the submission number ("Idea #7 added"). When voting opens the
ballot is frozen (most +1'd first, then oldest; hidden ideas skipped; at most
`maxCandidates`) and renumbered 1..N: `Round.candidates` holds the ballot order
and `Tally.number` the ballot number. **`!vote n` refers to the ballot number**,
which is what the overlay shows.

## Local e2e with the Twitch CLI mock EventSub server

`node scripts/e2e-local.mjs` (repo root) runs this process against the CLI
mock and a fake of the Twitch auth/Helix endpoints; see the root README
("Local end-to-end test"). By hand:

```
twitch event websocket start-server          # ws://127.0.0.1:8080/ws, subscriptions at http://127.0.0.1:8080/eventsub/subscriptions
EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws TWITCH_API_BASE=http://127.0.0.1:8080 npm run dev
```

`TWITCH_AUTH_BASE` (default `https://id.twitch.tv/oauth2`) can point login at a
fake too. Caveats of the CLI (v1.1.x): its subscription endpoint rejects
`channel.chat.message` (400 "combination of values in the type and version
fields is not valid"), and `twitch event trigger` cannot send chat messages,
so with the CLI alone the server only gets as far as the subscribe step.
The CLI is still the reference for `twitch event websocket reconnect`,
`close --reason=4006` and `keepalive --enabled=false`. Chat replies
(`POST /chat/messages`) are not served by the CLI; they fail and are dropped
with a log line.

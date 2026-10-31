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

```
twitch event websocket start-server          # ws://127.0.0.1:8080/ws, subscriptions at http://127.0.0.1:8080/eventsub/subscriptions
EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws TWITCH_API_BASE=http://127.0.0.1:8080 npm run dev
```

Login still goes to the real `id.twitch.tv` (use your app credentials); after
that the EventSub socket and the subscription request go to the mock. Use the
CLI to fire events / test resilience, e.g.
`twitch event trigger channel.chat.message --transport=websocket` and
`twitch event websocket reconnect`. Chat replies (`POST /chat/messages`) are
not served by the mock; they fail and are dropped with a log line.

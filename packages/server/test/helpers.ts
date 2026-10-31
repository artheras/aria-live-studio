import type { TwitchUser } from "@aria-live/shared";
import type { PlannedTask } from "../src/contracts.ts";
import { RoundEngine, type EngineSnapshot } from "../src/live/engine.ts";

export class FakeClock {
  t = 1_700_000_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export function makeEngine(snapshot?: EngineSnapshot) {
  const clock = new FakeClock();
  let n = 0;
  const engine = new RoundEngine({ now: clock.now, id: () => `id${++n}` }, snapshot);
  return { engine, clock };
}

export function user(name: string): TwitchUser {
  return { id: `u-${name}`, login: name, displayName: name.toUpperCase() };
}

export const plan: PlannedTask = {
  title: "Add dark mode",
  summary: "Toggle dark mode",
  userStory: "As a viewer I want dark mode",
  acceptanceCriteria: ["toggle exists"],
  steps: ["add css"],
  risks: [],
  size: "S",
  source: "template",
  model: null,
};

export function chatEvent(text: string, opts: Partial<{ id: string; login: string; userId: string; badges: string[] }> = {}) {
  const login = opts.login ?? "viewer1";
  return {
    broadcaster_user_id: "1337",
    broadcaster_user_login: "streamer",
    broadcaster_user_name: "Streamer",
    chatter_user_id: opts.userId ?? `id-${login}`,
    chatter_user_login: login,
    chatter_user_name: login,
    message_id: opts.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    message: { text, fragments: [{ type: "text", text, cheermote: null, emote: null, mention: null }] },
    color: "#00FF00",
    badges: (opts.badges ?? []).map((b) => ({ set_id: b, id: "1", info: "" })),
    message_type: "text",
    cheer: null,
    reply: null,
    channel_points_custom_reward_id: null,
  };
}

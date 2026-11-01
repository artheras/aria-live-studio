/**
 * Pure parser: an EventSub `channel.chat.message` event -> a chat command.
 * Only explicit commands are recognised (`!idea`, `!+1`, `!vote`, `!ideas`,
 * `!aria`). Moderator sub-commands (`!aria open|vote|close|extend|hide`) are
 * only produced for the broadcaster and moderators; for anyone else they are
 * dropped (null), so viewers get no reply.
 */
import { COMMANDS, EXTEND_MAX_SEC, EXTEND_MIN_SEC, isModRole, type ChatRole, type TwitchUser } from "@aria-live/shared";
import { cleanText, containsLink } from "./text.ts";

/** Prefix on every chat message we send, so we never react to ourselves. */
export const REPLY_PREFIX = "[Aria]";

/** The fields of the channel.chat.message event we use. */
export interface ChatMessageEvent {
  broadcaster_user_id: string;
  broadcaster_user_login?: string;
  message_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message: { text: string };
  badges?: { set_id: string; id?: string; info?: string }[];
}

/** What a moderator can do from chat. Never planning, approving or running. */
export type ModAction =
  | { action: "open"; prompt: string }
  | { action: "vote" }
  | { action: "close" }
  | { action: "extend"; seconds: number }
  | { action: "hide"; number: number }
  /** approve / reject / plan / run / build / cancel: dashboard only. */
  | { action: "dashboard_only"; verb: string };

/** `!aria` sub-commands only moderators may use. */
const MOD_VERBS = new Set(["open", "vote", "close", "extend", "hide"]);
/** Sub-commands that exist only on the dashboard; mods get told so. */
const DASHBOARD_VERBS = new Set(["approve", "reject", "plan", "replan", "run", "build", "execute", "cancel", "start"]);

export type ChatCommand =
  | { kind: "idea"; text: string }
  /** +1 an existing idea by its submission number (`!idea +3`, `!+1 3`). */
  | { kind: "plus_one"; number: number }
  | { kind: "vote"; number: number }
  | { kind: "ideas" }
  | { kind: "help" }
  | ({ kind: "mod" } & ModAction)
  /** A recognised command that cannot be accepted; `reason` is viewer-facing. */
  | { kind: "invalid"; command: "idea" | "vote" | "aria"; reason: string };

export interface ParsedChat {
  messageId: string;
  user: TwitchUser;
  role: ChatRole;
  command: ChatCommand;
}

export interface ParseOptions {
  maxIdeaLength: number;
  /** Message ids returned by our own sendChatMessage calls. */
  ownMessageIds?: { has(id: string): boolean };
}

export function roleFromBadges(badges: ChatMessageEvent["badges"]): ChatRole {
  const ids = new Set((badges ?? []).map((b) => b.set_id));
  if (ids.has("broadcaster")) return "broadcaster";
  if (ids.has("moderator")) return "moderator";
  if (ids.has("vip")) return "vip";
  if (ids.has("subscriber") || ids.has("founder")) return "subscriber";
  return "viewer";
}

/** Returns null for anything that is not one of our commands (or is our own message). */
export function parseChatMessage(ev: ChatMessageEvent, opts: ParseOptions): ParsedChat | null {
  if (!ev || typeof ev.message?.text !== "string" || !ev.chatter_user_id) return null;
  if (opts.ownMessageIds?.has(ev.message_id)) return null;
  const text = cleanText(ev.message.text);
  if (!text || text.startsWith(REPLY_PREFIX)) return null;
  if (!text.startsWith("!")) return null;

  const space = text.indexOf(" ");
  const head = (space === -1 ? text : text.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : text.slice(space + 1).trim();

  const role = roleFromBadges(ev.badges);
  let command: ChatCommand | null = null;
  switch (head) {
    case COMMANDS.plusOne: {
      const m = /^#?\s*(\d{1,3})$/.exec(rest);
      command = m ? { kind: "plus_one", number: Number(m[1]) } : { kind: "invalid", command: "idea", reason: "usage: !+1 <idea number>" };
      break;
    }
    case COMMANDS.idea: {
      const plus = /^\+\s*#?\s*(\d{1,3})$/.exec(rest);
      if (plus) command = { kind: "plus_one", number: Number(plus[1]) };
      else if (!rest) command = { kind: "invalid", command: "idea", reason: "usage: !idea <your idea>" };
      else if (rest.length > opts.maxIdeaLength)
        command = { kind: "invalid", command: "idea", reason: `ideas are max ${opts.maxIdeaLength} characters` };
      else if (containsLink(rest)) command = { kind: "invalid", command: "idea", reason: "links are not allowed" };
      else command = { kind: "idea", text: rest };
      break;
    }
    case COMMANDS.vote: {
      const m = /^#?\s*(\d{1,3})$/.exec(rest);
      command = m ? { kind: "vote", number: Number(m[1]) } : { kind: "invalid", command: "vote", reason: "usage: !vote <number>" };
      break;
    }
    case COMMANDS.ideas:
      command = { kind: "ideas" };
      break;
    case COMMANDS.help:
      command = parseAria(rest, role);
      if (!command) return null;
      break;
    default:
      return null;
  }

  return {
    messageId: ev.message_id,
    user: {
      id: ev.chatter_user_id,
      login: (ev.chatter_user_login || "").toLowerCase(),
      displayName: cleanText(ev.chatter_user_name || ev.chatter_user_login || ""),
    },
    role,
    command,
  };
}

/** `!aria [sub-command …]`. Returns null for a viewer's moderator command. */
function parseAria(rest: string, role: ChatRole): ChatCommand | null {
  if (!rest) return { kind: "help" };
  const space = rest.indexOf(" ");
  const verb = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const arg = space === -1 ? "" : rest.slice(space + 1).trim();
  const isMod = isModRole(role);
  if (MOD_VERBS.has(verb) || DASHBOARD_VERBS.has(verb)) {
    if (!isMod) return null; // viewers: silently ignored
  } else {
    return { kind: "help" }; // `!aria hello` etc. stays help, as before
  }
  const usage = (reason: string): ChatCommand => ({ kind: "invalid", command: "aria", reason });
  switch (verb) {
    case "open":
      if (containsLink(arg)) return usage("links are not allowed in the round theme");
      return { kind: "mod", action: "open", prompt: arg };
    case "vote":
    case "close":
      return arg ? usage(`usage: !aria ${verb}`) : { kind: "mod", action: verb };
    case "extend": {
      const m = /^(\d{1,4})\s*s?$/i.exec(arg);
      const n = m ? Number(m[1]) : NaN;
      if (!(n >= EXTEND_MIN_SEC && n <= EXTEND_MAX_SEC)) {
        return usage(`usage: !aria extend <seconds, ${EXTEND_MIN_SEC}-${EXTEND_MAX_SEC}>`);
      }
      return { kind: "mod", action: "extend", seconds: n };
    }
    case "hide": {
      const m = /^#?\s*(\d{1,3})$/.exec(arg);
      return m ? { kind: "mod", action: "hide", number: Number(m[1]) } : usage("usage: !aria hide <idea number>");
    }
    default:
      return { kind: "mod", action: "dashboard_only", verb };
  }
}

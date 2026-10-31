/**
 * Pure parser: an EventSub `channel.chat.message` event -> a chat command.
 * Only explicit commands are recognised (`!idea`, `!vote`, `!ideas`, `!aria`).
 */
import { COMMANDS, type ChatRole, type TwitchUser } from "@aria-live/shared";
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

export type ChatCommand =
  | { kind: "idea"; text: string }
  | { kind: "vote"; number: number }
  | { kind: "ideas" }
  | { kind: "help" }
  /** A recognised command that cannot be accepted; `reason` is viewer-facing. */
  | { kind: "invalid"; command: "idea" | "vote"; reason: string };

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

  let command: ChatCommand | null = null;
  switch (head) {
    case COMMANDS.idea: {
      if (!rest) command = { kind: "invalid", command: "idea", reason: "usage: !idea <your idea>" };
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
      command = { kind: "help" };
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
    role: roleFromBadges(ev.badges),
    command,
  };
}

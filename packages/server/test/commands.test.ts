import { describe, expect, it } from "vitest";
import { parseChatMessage, roleFromBadges } from "../src/live/commands.ts";
import { cleanText, containsLink, normalizeIdea } from "../src/live/text.ts";
import { chatEvent } from "./helpers.ts";

const opts = { maxIdeaLength: 40 };

describe("chat command parser", () => {
  it("parses !idea case-insensitively and collapses whitespace", () => {
    const p = parseChatMessage(chatEvent("  !IDEA   add    dark\tmode  "), opts);
    expect(p?.command).toEqual({ kind: "idea", text: "add dark mode" });
    expect(p?.user).toEqual({ id: "id-viewer1", login: "viewer1", displayName: "viewer1" });
  });

  it("strips control, zero-width and bidi characters", () => {
    const p = parseChatMessage(chatEvent("!idea​ add‮ dark\u0007 mode﻿⁦"), opts);
    expect(p?.command).toEqual({ kind: "idea", text: "add dark mode" });
    // a zero-width char inside the command word does not break it
    expect(parseChatMessage(chatEvent("!vo​te 2"), opts)?.command).toEqual({ kind: "vote", number: 2 });
  });

  it("keeps emoji and accents", () => {
    const p = parseChatMessage(chatEvent("!idea café mode 🎉"), opts);
    expect(p?.command).toEqual({ kind: "idea", text: "café mode 🎉" });
  });

  it("rejects links and over-long ideas with a reason", () => {
    for (const t of ["!idea see https://x.y", "!idea go to WWW.spam.example", "!idea http://evil", "!idea visit free.com now"]) {
      expect(parseChatMessage(chatEvent(t), opts)?.command).toMatchObject({ kind: "invalid", command: "idea", reason: "links are not allowed" });
    }
    expect(parseChatMessage(chatEvent(`!idea ${"a".repeat(41)}`), opts)?.command).toMatchObject({ kind: "invalid" });
    expect(parseChatMessage(chatEvent("!idea"), opts)?.command).toMatchObject({ kind: "invalid", reason: expect.stringMatching(/usage/) });
    // node.js / socket.io style names are not links
    expect(parseChatMessage(chatEvent("!idea use socket.io and node.js"), opts)?.command.kind).toBe("idea");
  });

  it("parses !vote n and !vote #n only", () => {
    expect(parseChatMessage(chatEvent("!vote 3"), opts)?.command).toEqual({ kind: "vote", number: 3 });
    expect(parseChatMessage(chatEvent("!Vote #2"), opts)?.command).toEqual({ kind: "vote", number: 2 });
    expect(parseChatMessage(chatEvent("!vote abc"), opts)?.command).toMatchObject({ kind: "invalid", command: "vote" });
    expect(parseChatMessage(chatEvent("!vote"), opts)?.command).toMatchObject({ kind: "invalid" });
    expect(parseChatMessage(chatEvent("3"), opts)).toBeNull();
  });

  it("parses !ideas and !aria, ignores everything else", () => {
    expect(parseChatMessage(chatEvent("!ideas"), opts)?.command).toEqual({ kind: "ideas" });
    expect(parseChatMessage(chatEvent("!ARIA"), opts)?.command).toEqual({ kind: "help" });
    expect(parseChatMessage(chatEvent("hello chat"), opts)).toBeNull();
    expect(parseChatMessage(chatEvent("!ideaz foo"), opts)).toBeNull();
    expect(parseChatMessage(chatEvent("!ideasfoo"), opts)).toBeNull();
  });

  it("ignores our own replies by prefix and by message id", () => {
    expect(parseChatMessage(chatEvent("[Aria] !idea x"), opts)).toBeNull();
    const own = new Set(["m-own"]);
    expect(parseChatMessage(chatEvent("!idea x", { id: "m-own" }), { ...opts, ownMessageIds: own })).toBeNull();
  });

  it("maps badges to roles", () => {
    expect(roleFromBadges([{ set_id: "subscriber" }, { set_id: "moderator" }])).toBe("moderator");
    expect(roleFromBadges([{ set_id: "broadcaster" }])).toBe("broadcaster");
    expect(roleFromBadges([{ set_id: "vip" }])).toBe("vip");
    expect(roleFromBadges([])).toBe("viewer");
    expect(parseChatMessage(chatEvent("!aria", { badges: ["founder"] }), opts)?.role).toBe("subscriber");
  });
});

describe("text helpers", () => {
  it("normalizes for dedupe", () => {
    expect(normalizeIdea("Add DARK-mode!!  please")).toBe("add dark mode please");
    expect(cleanText("a\u0000b‍c")).toBe("abc");
    expect(containsLink("https://a")).toBe(true);
    expect(containsLink("no link here")).toBe(false);
  });
});

describe("moderator commands and +1 by number", () => {
  const mod = { badges: ["moderator"] };
  const parse = (text: string, o: Parameters<typeof chatEvent>[1] = {}) => parseChatMessage(chatEvent(text, o), opts)?.command ?? null;

  it("parses mod sub-commands for moderators and the broadcaster", () => {
    expect(parse("!aria open boss fight ideas", mod)).toEqual({ kind: "mod", action: "open", prompt: "boss fight ideas" });
    expect(parse("!aria open", mod)).toEqual({ kind: "mod", action: "open", prompt: "" });
    expect(parse("!ARIA Vote", mod)).toEqual({ kind: "mod", action: "vote" });
    expect(parse("!aria close", { badges: ["broadcaster"] })).toEqual({ kind: "mod", action: "close" });
    expect(parse("!aria extend 30", mod)).toEqual({ kind: "mod", action: "extend", seconds: 30 });
    expect(parse("!aria extend 45s", mod)).toEqual({ kind: "mod", action: "extend", seconds: 45 });
    expect(parse("!aria hide #4", mod)).toEqual({ kind: "mod", action: "hide", number: 4 });
    for (const verb of ["approve", "run", "reject", "plan", "cancel"]) {
      expect(parse(`!aria ${verb}`, mod)).toEqual({ kind: "mod", action: "dashboard_only", verb });
    }
  });

  it("drops mod commands from everyone else; plain !aria stays help", () => {
    for (const badges of [[], ["subscriber"], ["vip"], ["founder"]]) {
      for (const t of ["!aria open x", "!aria vote", "!aria close", "!aria extend 30", "!aria hide 2", "!aria approve", "!aria extend nope"]) {
        expect(parse(t, { badges })).toBeNull();
      }
      expect(parse("!aria", { badges })).toEqual({ kind: "help" });
      expect(parse("!aria what is this", { badges })).toEqual({ kind: "help" });
    }
    expect(parse("!aria", mod)).toEqual({ kind: "help" });
    expect(parse("!aria hello", mod)).toEqual({ kind: "help" });
  });

  it("rejects malformed mod commands with a usage reason", () => {
    for (const t of ["!aria extend", "!aria extend abc", "!aria extend 4", "!aria extend 301", "!aria hide", "!aria hide two", "!aria close now", "!aria open see https://x.example"]) {
      expect(parse(t, mod)).toMatchObject({ kind: "invalid", command: "aria" });
    }
    expect(parse("!aria extend 5", mod)).toMatchObject({ kind: "mod", seconds: 5 });
    expect(parse("!aria extend 300", mod)).toMatchObject({ kind: "mod", seconds: 300 });
  });

  it("parses !idea +n and !+1 n; other text stays an idea", () => {
    expect(parse("!idea +3")).toEqual({ kind: "plus_one", number: 3 });
    expect(parse("!idea + #12")).toEqual({ kind: "plus_one", number: 12 });
    expect(parse("!+1 3")).toEqual({ kind: "plus_one", number: 3 });
    expect(parse("!+1 #7")).toEqual({ kind: "plus_one", number: 7 });
    expect(parse("!+1")).toMatchObject({ kind: "invalid", command: "idea" });
    expect(parse("!+1 abc")).toMatchObject({ kind: "invalid", command: "idea" });
    expect(parse("!idea +3 lives for the boss")).toEqual({ kind: "idea", text: "+3 lives for the boss" });
  });
});

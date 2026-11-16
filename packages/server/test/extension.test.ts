import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyExtensionJwt } from "../src/twitch/extension.ts";

function signJwt(payload: Record<string, unknown>, base64Secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", Buffer.from(base64Secret, "base64")).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

describe("verifyExtensionJwt", () => {
  const secret = Buffer.from("super-secret-twitch-extension-key").toString("base64");

  it("accepts a valid HS256 Twitch Extension JWT", () => {
    const token = signJwt(
      { channel_id: "1337", user_id: "42", opaque_user_id: "U42", role: "moderator", exp: 2000 },
      secret,
    );
    expect(verifyExtensionJwt(token, secret, 1000)).toEqual({
      channelId: "1337",
      userId: "42",
      opaqueUserId: "U42",
      role: "moderator",
    });
  });

  it("rejects expired or tampered tokens", () => {
    const expired = signJwt({ channel_id: "1337", opaque_user_id: "U42", exp: 500 }, secret);
    expect(verifyExtensionJwt(expired, secret, 1000)).toBeNull();

    const valid = signJwt({ channel_id: "1337", opaque_user_id: "U42", exp: 2000 }, secret);
    expect(verifyExtensionJwt(`${valid.slice(0, -2)}xx`, secret, 1000)).toBeNull();
  });
});

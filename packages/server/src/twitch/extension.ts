import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChatRole } from "@aria-live/shared";

export interface ExtensionJwtClaims {
  channelId: string;
  userId: string | null;
  opaqueUserId: string;
  role: ChatRole;
}

/**
 * Verify a Twitch Extension EBS JWT (HS256 signed with base64-decoded Extension Secret).
 * Returns null if the token is missing, malformed, expired, or invalid.
 */
export function verifyExtensionJwt(token: string, base64Secret: string, nowSec = Math.floor(Date.now() / 1000)): ExtensionJwtClaims | null {
  if (!token || !base64Secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let key: Buffer;
  try {
    key = Buffer.from(base64Secret, "base64");
  } catch {
    return null;
  }
  if (!key.length) return null;

  const expectedSig = createHmac("sha256", key).update(`${headerB64}.${payloadB64}`).digest();
  let givenSig: Buffer;
  try {
    givenSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (givenSig.length !== expectedSig.length || !timingSafeEqual(givenSig, expectedSig)) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (typeof payload.exp === "number" && payload.exp < nowSec) return null;
  const channelId = typeof payload.channel_id === "string" ? payload.channel_id : "";
  const opaqueUserId = typeof payload.opaque_user_id === "string" ? payload.opaque_user_id : "";
  if (!channelId || !opaqueUserId) return null;

  const rawRole = typeof payload.role === "string" ? payload.role : "viewer";
  const role: ChatRole =
    rawRole === "broadcaster" ? "broadcaster" : rawRole === "moderator" ? "moderator" : "viewer";

  return {
    channelId,
    userId: typeof payload.user_id === "string" && payload.user_id ? payload.user_id : null,
    opaqueUserId,
    role,
  };
}

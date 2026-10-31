/** Small pure text helpers shared by the command parser and the round engine. */

// C0/C1 controls, zero-width chars, bidi overrides/isolates, BOM, soft hyphen, tag chars.
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u{E0000}-\u{E007F}]/gu;

/** Strip control / zero-width / bidi characters and collapse whitespace. */
export function cleanText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** One line that is safe to show on stream: cleaned and length-capped. */
export function streamSafeLine(input: string, max = 500): string {
  const t = cleanText(input);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const LINK = /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|gg|tv|ly|xyz|ru)\b/i;

export function containsLink(text: string): boolean {
  return LINK.test(text);
}

/** Normalised form used for duplicate detection. */
export function normalizeIdea(text: string): string {
  return cleanText(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter(Boolean));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeIdea(a);
  const nb = normalizeIdea(b);
  if (na === nb) return true;
  return jaccard(tokenSet(na), tokenSet(nb)) >= 0.8;
}

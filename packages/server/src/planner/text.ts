/**
 * Text helpers shared by the planner and the executor: everything that came
 * from a viewer or a model is cleaned before it reaches a prompt or the stream.
 */

// C0/C1 control characters, DEL, zero-width and bidi-override characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
// ANSI escape sequences (CSI, OSC) — removed before the control-char pass.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** One line: ANSI and control chars removed, whitespace collapsed, trimmed. */
export function oneLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(ANSI, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** Cut to `max` characters (counting code points), ending with "…" when cut. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

export const UNTRUSTED_TAG = "untrusted_viewer_input";

/**
 * Viewer text made safe to put inside an untrusted block: one line, and it
 * cannot open or close the block itself (the tag name is removed).
 */
export function untrustedText(value: unknown, max = 500): string {
  const line = oneLine(value).replace(new RegExp(`</?\\s*${UNTRUSTED_TAG}\\s*>?`, "gi"), "[removed]");
  return truncate(line.replace(new RegExp(UNTRUSTED_TAG, "gi"), "[removed]"), max);
}

/** Wrap already-cleaned lines in the untrusted block. */
export function untrustedBlock(lines: string[]): string {
  return `<${UNTRUSTED_TAG}>\n${lines.join("\n")}\n</${UNTRUSTED_TAG}>`;
}

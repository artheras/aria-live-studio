#!/usr/bin/env node
/**
 * Zips the skills for Claude.ai / Claude Desktop "Upload skill"
 * (Settings → Capabilities → Skills): one zip per skill, with the skill folder
 * at the zip root (aria-live-cohost/SKILL.md …).
 *
 *   node scripts/package-claude-skill.mjs                 → dist/aria-live-cohost.zip, dist/aria-live.zip
 *   node scripts/package-claude-skill.mjs aria-live-cohost
 *
 * Checks Claude's upload rules first: name ≤ 64 chars of a-z0-9-, without
 * "anthropic" or "claude"; description non-empty, ≤ 1024 chars, no XML tags.
 * The archive is deterministic (fixed timestamps, sorted entries).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { listFiles } from "./package-skills.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SKILLS = ["aria-live-cohost", "aria-live"];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal ZIP (deflate) writer: entries = [{ name, data }]. */
export function zip(entries) {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = (2020 - 1980) << 9 | 1 << 5 | 1; // 2020-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function frontmatterField(text, key) {
  const end = text.indexOf("\n---\n", 4);
  const m = new RegExp(`^${key}:\\s?(.*)$`, "m").exec(text.slice(4, end));
  return m ? m[1].trim() : "";
}

export function checkForClaude(name) {
  const text = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
  const errors = [];
  const fmName = frontmatterField(text, "name");
  const description = frontmatterField(text, "description");
  if (!/^[a-z0-9-]{1,64}$/.test(fmName) || fmName !== name) errors.push(`name "${fmName}" must equal the folder name and be ≤ 64 chars of a-z, 0-9 and -`);
  if (/anthropic|claude/.test(fmName)) errors.push(`name "${fmName}" may not contain "anthropic" or "claude"`);
  if (!description) errors.push("description is empty");
  if (description.length > 1024) errors.push(`description is ${description.length} characters (max 1024)`);
  if (/<[^>]*>/.test(description)) errors.push("description may not contain XML tags");
  return errors;
}

function main() {
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  mkdirSync(join(ROOT, "dist"), { recursive: true });
  let failed = false;
  for (const name of names.length ? names : DEFAULT_SKILLS) {
    const errors = checkForClaude(name);
    if (errors.length) {
      for (const e of errors) console.error(`✗ skills/${name}: ${e}`);
      failed = true;
      continue;
    }
    const folder = join(ROOT, "skills", name);
    const entries = listFiles(folder).map((rel) => ({ name: `${name}/${rel}`, data: readFileSync(join(folder, rel)) }));
    const out = join(ROOT, "dist", `${name}.zip`);
    writeFileSync(out, zip(entries));
    console.log(`✓ dist/${name}.zip (${entries.map((e) => e.name).join(", ")})`);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

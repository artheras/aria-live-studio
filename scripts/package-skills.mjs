#!/usr/bin/env node
/**
 * Keeps the skills in sync across the places each host reads them from.
 *
 *   skills/<name>/              canonical (Aria Code `/skills add`, Codex, Claude.ai upload)
 *   plugin/skills/<name>/       byte-identical mirror (Claude Code loads skills from the plugin dir)
 *   .claude-plugin/skills.lock.json
 *                               integrity lock Aria Code verifies before it activates a skill
 *                               (schema aria.skills-lock.v1, same hash as aria_skills.loader.skill_tree_sha256)
 *
 *   node scripts/package-skills.mjs           validate, sync the mirror, write the lock
 *   node scripts/package-skills.mjs --check   validate and fail on any drift (CI)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const MIRROR = join(ROOT, "plugin", "skills");
const MARKETPLACE = join(ROOT, ".claude-plugin", "marketplace.json");
const LOCK = join(ROOT, ".claude-plugin", "skills.lock.json");

/** Mirrors aria_skills.loader: these never count toward the hash. */
const IGNORED_NAMES = new Set([".DS_Store", ".pytest_cache", "__pycache__"]);
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SKILL_CHARS = 20_000;
/** Claude.ai's skill upload limit for the description. */
const MAX_DESCRIPTION_CHARS = 1024;

const ignored = (rel) => rel.split("/").some((p) => IGNORED_NAMES.has(p)) || rel.endsWith(".pyc");

/** Files under `folder`, as POSIX relative paths, in Python `sorted(Path…)` order (by parts). */
export function listFiles(folder) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (statSync(full).isFile()) out.push(relative(folder, full).split(sep).join("/"));
    }
  };
  walk(folder);
  const cmp = (a, b) => {
    const pa = a.split("/");
    const pb = b.split("/");
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return pa.length - pb.length;
  };
  return out.filter((rel) => !ignored(rel)).sort(cmp);
}

/** Same digest as aria_skills.loader.skill_tree_sha256. */
export function skillTreeSha256(folder) {
  const digest = createHash("sha256");
  for (const rel of listFiles(folder)) {
    digest.update(Buffer.from(rel, "utf8"));
    digest.update(Buffer.from([0]));
    digest.update(readFileSync(join(folder, rel)));
    digest.update(Buffer.from([0]));
  }
  return digest.digest("hex");
}

function frontmatter(text) {
  const end = text.indexOf("\n---\n", 4);
  if (!text.startsWith("---\n") || end < 0) return null;
  const fields = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([a-z_]+):\s?(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fields, body: text.slice(end + 5).trim() };
}

const quotedPhrases = (description) =>
  [...description.matchAll(/"([^"]+)"|“([^”]+)”|'([^']+)'/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim().toLowerCase());

/** The loader limits and description rules from the Aria skills spec. Returns error strings. */
export function validateSkills(names) {
  const errors = [];
  const phrases = new Map();
  for (const name of names) {
    const folder = join(SKILLS, name);
    const where = `skills/${name}/SKILL.md`;
    if (!existsSync(join(folder, "SKILL.md"))) {
      errors.push(`${where}: missing`);
      continue;
    }
    const raw = readFileSync(join(folder, "SKILL.md"));
    const text = raw.toString("utf8");
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) errors.push(`${where}: has a byte-order mark`);
    if (text.length > MAX_SKILL_CHARS) errors.push(`${where}: ${text.length} characters (max ${MAX_SKILL_CHARS})`);
    for (const rel of listFiles(folder)) {
      if (readFileSync(join(folder, rel)).includes(13)) errors.push(`skills/${name}/${rel}: CRLF or CR line endings (use LF)`);
    }
    const fm = frontmatter(text);
    if (!fm) {
      errors.push(`${where}: must start with "---\\n" frontmatter`);
      continue;
    }
    const { fields, body } = fm;
    if (!NAME_RE.test(fields.name ?? "") || fields.name !== name) errors.push(`${where}: name must be "${name}" (folder name, ${NAME_RE})`);
    const description = fields.description ?? "";
    if (!description) errors.push(`${where}: empty description`);
    if (description.length > MAX_DESCRIPTION_CHARS) errors.push(`${where}: description is ${description.length} characters (max ${MAX_DESCRIPTION_CHARS})`);
    if (!/Do NOT trigger/.test(description)) errors.push(`${where}: description needs a "Do NOT trigger …" clause`);
    if (!body) errors.push(`${where}: empty body`);
    for (const phrase of quotedPhrases(description)) {
      const cjk = /[㐀-鿿]/.test(phrase);
      if (phrase.length < (cjk ? 4 : 5) || (!cjk && !/\s/.test(phrase))) {
        errors.push(`${where}: trigger phrase "${phrase}" is too short or a single word`);
      }
      phrases.set(phrase, [...(phrases.get(phrase) ?? []), name]);
    }
    try {
      const policy = JSON.parse(readFileSync(join(folder, "skill-policy.json"), "utf8"));
      if (policy.schema_version !== "aria.skill-policy.v1") errors.push(`skills/${name}/skill-policy.json: schema_version must be aria.skill-policy.v1`);
    } catch (error) {
      errors.push(`skills/${name}/skill-policy.json: ${error.message}`);
    }
  }
  const all = [...phrases.keys()];
  for (const a of all) {
    for (const b of all) {
      if (a === b) continue;
      const owners = new Set([...phrases.get(a), ...phrases.get(b)]);
      if (b.includes(a) && owners.size > 1) errors.push(`trigger phrase "${a}" is contained in "${b}" of another skill`);
    }
  }
  return errors;
}

/** Skills registered in marketplace.json, resolved like Aria Code does (relative to the repository root). */
function registered(marketplace) {
  const entries = [];
  const catalogVersion = String(marketplace.metadata?.version ?? "");
  for (const plugin of marketplace.plugins ?? []) {
    for (const path of plugin.skills ?? []) {
      const folder = resolve(ROOT, path);
      entries.push({ plugin: String(plugin.name), version: String(plugin.version ?? catalogVersion), folder, path });
    }
  }
  return { entries, catalogVersion };
}

export function buildLock() {
  const marketplace = JSON.parse(readFileSync(MARKETPLACE, "utf8"));
  const { entries, catalogVersion } = registered(marketplace);
  const skills = {};
  for (const e of entries) {
    const name = e.folder.split(sep).pop();
    skills[`${e.plugin}:${name}`] = {
      path: relative(ROOT, e.folder).split(sep).join("/"),
      sha256: skillTreeSha256(e.folder),
      version: e.version,
    };
  }
  const sorted = Object.fromEntries(Object.entries(skills).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    schema_version: "aria.skills-lock.v1",
    organization: "artheras",
    repository: String(marketplace.plugins?.[0]?.repository ?? marketplace.metadata?.repository ?? ""),
    catalog_version: catalogVersion,
    skills: sorted,
  };
}

function main() {
  const check = process.argv.includes("--check");
  const problems = [];
  const names = readdirSync(SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  problems.push(...validateSkills(names));

  const marketplace = JSON.parse(readFileSync(MARKETPLACE, "utf8"));
  const { entries } = registered(marketplace);
  const listed = new Set(entries.map((e) => e.folder));
  for (const name of names) {
    if (!listed.has(join(SKILLS, name))) problems.push(`skills/${name} is not listed in .claude-plugin/marketplace.json plugins[].skills`);
  }
  for (const e of entries) {
    if (!e.folder.startsWith(SKILLS + sep) || !existsSync(join(e.folder, "SKILL.md"))) {
      problems.push(`marketplace.json lists ${e.path}, which is not a folder in skills/`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }

  // Mirror: plugin/skills/<name> must be byte-identical to skills/<name>.
  const mirrorNames = existsSync(MIRROR)
    ? readdirSync(MIRROR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  const drift = [];
  for (const name of mirrorNames) if (!names.includes(name)) drift.push(`plugin/skills/${name} has no canonical skills/${name}`);
  for (const name of names) {
    const src = join(SKILLS, name);
    const dst = join(MIRROR, name);
    const srcFiles = listFiles(src);
    const dstFiles = existsSync(dst) ? listFiles(dst) : [];
    for (const rel of dstFiles) if (!srcFiles.includes(rel)) drift.push(`plugin/skills/${name}/${rel} is not in skills/${name}`);
    for (const rel of srcFiles) {
      const target = join(dst, rel);
      if (!existsSync(target)) drift.push(`plugin/skills/${name}/${rel} is missing`);
      else if (!readFileSync(target).equals(readFileSync(join(src, rel)))) drift.push(`plugin/skills/${name}/${rel} differs from skills/${name}/${rel}`);
    }
  }

  const rendered = `${JSON.stringify(buildLock(), null, 2)}\n`;
  const current = existsSync(LOCK) ? readFileSync(LOCK, "utf8") : "";
  if (current !== rendered) drift.push(".claude-plugin/skills.lock.json is stale");

  if (check) {
    if (drift.length) {
      for (const d of drift) console.error(`✗ ${d}`);
      console.error("Run: node scripts/package-skills.mjs");
      process.exit(1);
    }
    console.log(`✓ ${names.length} skills valid; plugin/skills mirror and skills.lock.json are current`);
    return;
  }

  for (const name of mirrorNames) if (!names.includes(name)) rmSync(join(MIRROR, name), { recursive: true, force: true });
  for (const name of names) {
    const src = join(SKILLS, name);
    const dst = join(MIRROR, name);
    rmSync(dst, { recursive: true, force: true });
    for (const rel of listFiles(src)) {
      mkdirSync(dirname(join(dst, rel)), { recursive: true });
      writeFileSync(join(dst, rel), readFileSync(join(src, rel)));
    }
  }
  writeFileSync(LOCK, rendered);
  console.log(`✓ synced ${names.length} skills to plugin/skills and wrote .claude-plugin/skills.lock.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

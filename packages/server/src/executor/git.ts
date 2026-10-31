/** Isolated git worktrees: the agent never touches the streamer's checkout. */
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface Worktree {
  branch: string;
  dir: string;
}

export function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim()}`));
        else resolvePromise(stdout);
      },
    );
  });
}

/** Reason the repo cannot be used, or null when it is a git work tree with a commit at HEAD. */
export async function repoProblem(targetRepo: string | undefined): Promise<string | null> {
  if (!targetRepo) return "TARGET_REPO is not set";
  try {
    if ((await git(targetRepo, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true") {
      return `TARGET_REPO is not a git work tree: ${targetRepo}`;
    }
  } catch {
    return `TARGET_REPO is not a git work tree: ${targetRepo}`;
  }
  try {
    await git(targetRepo, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  } catch {
    return "TARGET_REPO has no commit at HEAD";
  }
  return null;
}

export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "task";
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** `git worktree add -b aria-live/<stamp>-<slug> <dataDir>/worktrees/<id> HEAD`. */
export async function createWorktree(targetRepo: string, dataDir: string, id: string, title: string): Promise<Worktree> {
  const problem = await repoProblem(targetRepo);
  if (problem) throw new Error(problem);
  const base = `aria-live/${stamp(new Date())}-${slugify(title)}`;
  let branch = base;
  for (let n = 2; await branchExists(targetRepo, branch); n++) branch = `${base}-${n}`;
  const root = resolve(dataDir, "worktrees");
  await mkdir(root, { recursive: true });
  const dir = join(root, id.replace(/[^A-Za-z0-9_-]/g, "_"));
  await git(targetRepo, ["worktree", "add", "-b", branch, dir, "HEAD"], 120_000);
  return { branch, dir };
}

/** Files changed in the worktree (modified, added, deleted, untracked), sorted. */
export async function changedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const parts = out.split("\0");
  const files = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    files.add(entry.slice(3));
    if (status.includes("R") || status.includes("C")) i++; // next part is the original path
  }
  return [...files].sort();
}

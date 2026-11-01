/**
 * Persistence: the engine snapshot (minus activity) to dataDir/state.json,
 * written atomically (tmp + rename) and debounced; round history appended
 * to dataDir/history.jsonl.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoundSummary } from "@aria-live/shared";
import type { EngineSnapshot } from "./engine.ts";

export class Store {
  private timer: NodeJS.Timeout | null = null;
  private readonly inflight = new Set<Promise<void>>();
  private pending: (() => EngineSnapshot) | null = null;
  readonly statePath: string;
  readonly historyPath: string;

  constructor(
    readonly dataDir: string,
    private readonly debounceMs = 500,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.statePath = join(dataDir, "state.json");
    this.historyPath = join(dataDir, "history.jsonl");
  }

  loadState(): EngineSnapshot | undefined {
    if (!existsSync(this.statePath)) return undefined;
    try {
      const snap = JSON.parse(readFileSync(this.statePath, "utf8")) as EngineSnapshot;
      if (!snap || typeof snap !== "object" || !snap.state) return undefined;
      return snap;
    } catch (err) {
      console.warn(`[store] could not read ${this.statePath}: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Schedule a debounced write; `get` is called when the write happens. */
  scheduleSave(get: () => EngineSnapshot): void {
    this.pending = get;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const get = this.pending;
    this.pending = null;
    if (!get) return;
    const snap = get();
    const { activity: _a, ...state } = snap.state;
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ state, internals: snap.internals }), { mode: 0o600 });
      renameSync(tmp, this.statePath);
    } catch (err) {
      console.error(`[store] save failed: ${(err as Error).message}`);
    }
  }

  async appendHistory(summary: RoundSummary): Promise<void> {
    const write = appendFile(this.historyPath, `${JSON.stringify(summary)}\n`, { mode: 0o600 });
    this.inflight.add(write);
    try {
      await write;
    } finally {
      this.inflight.delete(write);
    }
  }

  /** Write the pending state now and wait for history appends still in flight. */
  async close(): Promise<void> {
    this.flush();
    await Promise.allSettled([...this.inflight]);
  }

  /** Newest first. */
  async readHistory(limit = 50): Promise<RoundSummary[]> {
    let raw: string;
    try {
      raw = await readFile(this.historyPath, "utf8");
    } catch {
      return [];
    }
    const out: RoundSummary[] = [];
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as RoundSummary);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }
}

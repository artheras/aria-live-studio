/** Minimal, tactile Web Audio cue synthesizer (no external files, safe in headless/jsdom). */

export type StudioCue = "open" | "lead_change" | "shipped" | "click" | "hop" | "spark" | "approve";

let audioCtx: AudioContext | null = null;
let sfxEnabled = true;

export function isSfxEnabled(): boolean {
  return sfxEnabled;
}

export function setSfxEnabled(enabled: boolean): void {
  sfxEnabled = enabled;
}

export function playCue(cue: StudioCue): void {
  if (!sfxEnabled || typeof window === "undefined") return;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;

  try {
    audioCtx ??= new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;

    if (cue === "click") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(560, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.035);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.032, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
      return;
    }

    if (cue === "hop") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.085);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.042, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }

    const notes =
      cue === "open"
        ? [440, 587.33]
        : cue === "approve"
          ? [440, 659.25]
          : cue === "spark"
            ? [880, 1318.5]
            : cue === "lead_change"
              ? [523.25, 659.25]
              : [523.25, 659.25, 783.99];

    notes.forEach((freq, i) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = cue === "lead_change" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.065);
      gain.gain.setValueAtTime(0.0001, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(cue === "spark" ? 0.028 : 0.04, now + i * 0.065 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.065 + 0.14);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.15);
    });
  } catch {
    // Audio playback is best-effort only.
  }
}

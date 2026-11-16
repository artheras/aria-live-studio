/** Minimal, tactile Web Audio cue synthesizer (no external files, safe in headless/jsdom). */

export type StudioCue = "open" | "lead_change" | "shipped";

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
    const notes =
      cue === "open"
        ? [440, 587.33]
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
      gain.gain.exponentialRampToValueAtTime(0.04, now + i * 0.065 + 0.015);
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

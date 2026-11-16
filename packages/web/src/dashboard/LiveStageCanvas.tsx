import { useEffect, useRef } from "react";
import type { LiveState } from "@aria-live/shared";

interface Pulse {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
}

interface RingWave {
  r: number;
  maxR: number;
  color: string;
  alpha: number;
}

/**
 * Interactive geometric Boss Arena driven by real Twitch round & EventSub state.
 * Safe in headless/jsdom environments where 2D canvas context is unavailable.
 */
export function LiveStageCanvas({ state }: { state: LiveState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const pulsesRef = useRef<Pulse[]>([]);
  const wavesRef = useRef<RingWave[]>([]);
  const lastCelebrationIdRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 160, y: 260 });

  stateRef.current = state;

  useEffect(() => {
    const latest = state.celebrations?.at(-1);
    if (!latest || latest.id === lastCelebrationIdRef.current) return;
    lastCelebrationIdRef.current = latest.id;
    wavesRef.current.push({
      r: 22,
      maxR: 280,
      color: latest.kind === "bits" || latest.kind === "channel_points" ? "#F5B942" : "#2FD48A",
      alpha: 0.9,
    });
  }, [state.celebrations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;

    const draw = () => {
      t += 0.022;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w * 0.64;
      const cy = h * 0.48;

      ctx.fillStyle = "#08090e";
      ctx.fillRect(0, 0, w, h);

      // Subtle 24px engineering grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 28) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 28) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      const s = stateRef.current;
      const ideas = s.round?.ideas.filter((i) => !i.hidden) ?? [];
      const phase = s.round?.phase ?? "idle";

      // Expanding shockwaves (triggered by click or Twitch Raid/Bits/Channel Points)
      wavesRef.current = wavesRef.current.filter((wave) => {
        wave.r += 4.2;
        wave.alpha *= 0.96;
        ctx.strokeStyle = wave.color;
        ctx.globalAlpha = Math.max(0, wave.alpha);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, wave.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        return wave.r < wave.maxR && wave.alpha > 0.03;
      });

      // Rotating wireframe Boss polygon
      const sides = Math.max(5, Math.min(9, 5 + (s.stats.rounds % 4)));
      const bossR = 46 + Math.sin(t * 1.8) * 3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * (phase === "executing" ? 1.4 : 0.45));
      ctx.strokeStyle = phase === "done" ? "#2FD48A" : "#9146FF";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const px = Math.cos(ang) * bossR;
        const py = Math.sin(ang) * bossR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = phase === "done" ? "rgba(47, 212, 138, 0.12)" : "rgba(145, 70, 255, 0.14)";
      ctx.fill();
      ctx.restore();

      // Allied viewer orbiters (one per submitted !idea)
      const orbitCount = Math.min(ideas.length, 10);
      for (let i = 0; i < orbitCount; i++) {
        const idea = ideas[i]!;
        const ang = t * 0.7 + (i / Math.max(1, orbitCount)) * Math.PI * 2;
        const rx = 108 + (i % 2) * 26;
        const ry = 82 + (i % 2) * 20;
        const ox = cx + Math.cos(ang) * rx;
        const oy = cy + Math.sin(ang) * ry;

        ctx.fillStyle = idea.boosts ? "#F5B942" : "#2FD48A";
        ctx.beginPath();
        ctx.arc(ox, oy, idea.boosts ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "10px monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
        ctx.fillText(`@${idea.author.login}`, ox + 8, oy + 3);
      }

      // Pointer craft & active projectiles
      const ship = pointerRef.current;
      ctx.strokeStyle = "#5cb8ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ship.x + 12, ship.y);
      ctx.lineTo(ship.x - 8, ship.y - 7);
      ctx.lineTo(ship.x - 4, ship.y);
      ctx.lineTo(ship.x - 8, ship.y + 7);
      ctx.closePath();
      ctx.stroke();

      pulsesRef.current = pulsesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.8, p.y - p.vy * 1.8);
        ctx.stroke();
        const hitDist = Math.hypot(p.x - cx, p.y - cy);
        if (hitDist < bossR) {
          wavesRef.current.push({ r: 10, maxR: 75, color: "#9146FF", alpha: 0.65 });
          return false;
        }
        return p.life > 0;
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fireAtBoss = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    pointerRef.current = { x, y };
    const cx = canvas.width * 0.64;
    const cy = canvas.height * 0.48;
    const ang = Math.atan2(cy - y, cx - x);
    pulsesRef.current.push({
      x,
      y,
      vx: Math.cos(ang) * 9,
      vy: Math.sin(ang) * 9,
      color: "#2FD48A",
      life: 60,
    });
  };

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={360}
      className="stage-canvas"
      onMouseMove={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        pointerRef.current = {
          x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
          y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
        };
      }}
      onClick={fireAtBoss}
      title="Click to fire at the Boss core"
    />
  );
}

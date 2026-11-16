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

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
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
  const sparksRef = useRef<Spark[]>([]);
  const lastCelebrationIdRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 140, y: 240 });
  const hitsRef = useRef(0);
  const tierRef = useRef(1);
  const hpRef = useRef(25);
  const maxHpRef = useRef(25);

  stateRef.current = state;

  useEffect(() => {
    const latest = state.celebrations?.at(-1);
    if (!latest || latest.id === lastCelebrationIdRef.current) return;
    lastCelebrationIdRef.current = latest.id;
    wavesRef.current.push({
      r: 22,
      maxR: 320,
      color: latest.kind === "bits" || latest.kind === "channel_points" ? "#F5B942" : "#2FD48A",
      alpha: 0.92,
    });
  }, [state.celebrations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;

    // Static ambient particles
    const stars = Array.from({ length: 28 }, (_, i) => ({
      x: ((i * 97) % 640),
      y: ((i * 53) % 360),
      speed: 0.15 + (i % 4) * 0.12,
      size: i % 3 === 0 ? 1.5 : 1,
    }));

    const draw = () => {
      t += 0.022;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w * 0.65;
      const cy = h * 0.5;

      ctx.fillStyle = "#08090e";
      ctx.fillRect(0, 0, w, h);

      // Subtle radial core glow
      const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 175);
      glow.addColorStop(0, "rgba(145, 70, 255, 0.22)");
      glow.addColorStop(0.5, "rgba(145, 70, 255, 0.05)");
      glow.addColorStop(1, "rgba(8, 9, 14, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Precision 32px engineering grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.032)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 32) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 32) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Drifting ambient telemetry particles
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      for (const st of stars) {
        st.x = (st.x + st.speed) % w;
        ctx.fillRect(st.x, st.y, st.size, st.size);
      }

      const s = stateRef.current;
      const ideas = s.round?.ideas.filter((i) => !i.hidden) ?? [];
      const phase = s.round?.phase ?? "idle";

      // Expanding shockwaves
      wavesRef.current = wavesRef.current.filter((wave) => {
        wave.r += 4.2;
        wave.alpha *= 0.955;
        ctx.strokeStyle = wave.color;
        ctx.globalAlpha = Math.max(0, wave.alpha);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, wave.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        return wave.r < wave.maxR && wave.alpha > 0.03;
      });

      // Outer dashed orbital ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.25);
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = "rgba(181, 137, 255, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 84, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Rotating dual-layer wireframe Boss polygon
      const sides = Math.max(5, Math.min(8, 5 + (s.stats.rounds % 4)));
      const bossR = 46 + Math.sin(t * 2) * 3;
      const coreColor = phase === "done" ? "#2FD48A" : "#9146FF";

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * (phase === "executing" ? 1.4 : 0.45));
      ctx.strokeStyle = coreColor;
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
      ctx.fillStyle = phase === "done" ? "rgba(47, 212, 138, 0.14)" : "rgba(145, 70, 255, 0.16)";
      ctx.fill();

      // Inner counter-rotating core
      ctx.rotate(-t * 1.1);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const px = Math.cos(ang) * (bossR * 0.48);
        const py = Math.sin(ang) * (bossR * 0.48);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();

      // Allied viewer orbiters (one per submitted !idea)
      const orbitCount = Math.min(ideas.length, 10);
      for (let i = 0; i < orbitCount; i++) {
        const idea = ideas[i]!;
        const ang = t * 0.7 + (i / Math.max(1, orbitCount)) * Math.PI * 2;
        const rx = 114 + (i % 2) * 24;
        const ry = 86 + (i % 2) * 18;
        const ox = cx + Math.cos(ang) * rx;
        const oy = cy + Math.sin(ang) * ry;

        ctx.fillStyle = idea.boosts ? "#F5B942" : "#2FD48A";
        ctx.beginPath();
        ctx.arc(ox, oy, idea.boosts ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "10px monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
        ctx.fillText(`@${idea.author.login}`, ox + 8, oy + 3);
      }

      // Pointer craft & subtle aim line
      const ship = pointerRef.current;
      const aimAng = Math.atan2(cy - ship.y, cx - ship.x);
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(aimAng);
      ctx.strokeStyle = "#5cb8ff";
      ctx.fillStyle = "rgba(92, 184, 255, 0.16)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(-9, -7);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-9, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Projectiles + hit sparks
      pulsesRef.current = pulsesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.9, p.y - p.vy * 1.9);
        ctx.stroke();
        if (Math.hypot(p.x - cx, p.y - cy) < bossR) {
          hitsRef.current += 1;
          hpRef.current = Math.max(0, hpRef.current - 1);
          if (hpRef.current === 0) {
            tierRef.current += 1;
            maxHpRef.current = 25 + (tierRef.current - 1) * 5;
            hpRef.current = maxHpRef.current;
            wavesRef.current.push({ r: 16, maxR: 340, color: "#2FD48A", alpha: 1 });
          } else {
            wavesRef.current.push({ r: 12, maxR: 84, color: "#9146FF", alpha: 0.7 });
          }
          for (let k = 0; k < 6; k++) {
            const sa = (k / 6) * Math.PI * 2 + t;
            sparksRef.current.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(sa) * 2.8,
              vy: Math.sin(sa) * 2.8,
              color: "#2FD48A",
              life: 16,
            });
          }
          return false;
        }
        return p.life > 0;
      });

      sparksRef.current = sparksRef.current.filter((sp) => {
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.life -= 1;
        ctx.fillStyle = sp.color;
        ctx.globalAlpha = sp.life / 16;
        ctx.fillRect(sp.x, sp.y, 2, 2);
        ctx.globalAlpha = 1;
        return sp.life > 0;
      });

      // Top-left minimal telemetry HUD inside canvas
      ctx.font = "11px monospace";
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.fillText(`PHASE // ${phase.toUpperCase()}`, 18, 28);
      ctx.fillText(`ORBITERS // ${ideas.length}`, 18, 44);
      ctx.fillText(`HITS // ${hitsRef.current}`, 18, 60);

      // Top-right Boss HP bar
      const barW = 132;
      const barX = w - barW - 18;
      const barY = 24;
      const hpFrac = Math.max(0, Math.min(1, hpRef.current / maxHpRef.current));
      ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
      ctx.fillText(`CORE MK-${tierRef.current} // ${hpRef.current}/${maxHpRef.current}`, barX, barY - 6);
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.fillRect(barX, barY, barW, 5);
      ctx.fillStyle = hpFrac > 0.35 ? "#9146FF" : "#F5B942";
      ctx.fillRect(barX, barY, barW * hpFrac, 5);

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
    const cx = canvas.width * 0.65;
    const cy = canvas.height * 0.5;
    const ang = Math.atan2(cy - y, cx - x);
    pulsesRef.current.push({
      x,
      y,
      vx: Math.cos(ang) * 10,
      vy: Math.sin(ang) * 10,
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

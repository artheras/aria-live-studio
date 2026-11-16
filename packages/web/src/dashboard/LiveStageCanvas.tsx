import { useEffect, useRef } from "react";
import type { LiveState } from "@aria-live/shared";
import { truncate } from "../lib/time";

interface VoxelParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

const ISO_X = 16;
const ISO_Y = 8;
const ISO_Z = 14;

/** Draw one 2.5D isometric voxel block at grid (gx, gy, gz). */
function drawVoxel(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  gx: number,
  gy: number,
  gz: number,
  top: string,
  left: string,
  right: string,
): void {
  const sx = ox + (gx - gy) * ISO_X;
  const sy = oy + (gx + gy) * ISO_Y - gz * ISO_Z;

  // Top face
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(sx, sy - ISO_Y);
  ctx.lineTo(sx + ISO_X, sy);
  ctx.lineTo(sx, sy + ISO_Y);
  ctx.lineTo(sx - ISO_X, sy);
  ctx.closePath();
  ctx.fill();

  // Left face
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(sx - ISO_X, sy);
  ctx.lineTo(sx, sy + ISO_Y);
  ctx.lineTo(sx, sy + ISO_Y + ISO_Z);
  ctx.lineTo(sx - ISO_X, sy + ISO_Z);
  ctx.closePath();
  ctx.fill();

  // Right face
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(sx + ISO_X, sy);
  ctx.lineTo(sx, sy + ISO_Y);
  ctx.lineTo(sx, sy + ISO_Y + ISO_Z);
  ctx.lineTo(sx + ISO_X, sy + ISO_Z);
  ctx.closePath();
  ctx.fill();
}

/**
 * Lightweight 2.5D isometric voxel workshop driven by real Twitch round & Co-Builder state.
 * Grows block-by-block as rounds ship; safe in headless/jsdom environments.
 */
export function LiveStageCanvas({ state }: { state: LiveState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const particlesRef = useRef<VoxelParticle[]>([]);
  const lastCelebrationIdRef = useRef<string | null>(null);

  stateRef.current = state;

  const spawnBurst = (cx: number, cy: number, color: string, count = 14) => {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 1.2 + Math.random() * 2.6;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1.4,
        size: 3 + (i % 3),
        color,
        life: 36,
        maxLife: 36,
      });
    }
  };

  useEffect(() => {
    const latest = state.celebrations?.at(-1);
    if (!latest || latest.id === lastCelebrationIdRef.current) return;
    lastCelebrationIdRef.current = latest.id;
    const color = latest.kind === "bits" || latest.kind === "channel_points" ? "#F5B942" : "#B589FF";
    spawnBurst(320, 145, color, 20);
  }, [state.celebrations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;

    const motes = Array.from({ length: 24 }, (_, i) => ({
      x: (i * 89) % 640,
      y: 40 + ((i * 61) % 290),
      speed: 0.25 + (i % 3) * 0.14,
      size: i % 2 === 0 ? 3 : 2,
      violet: i % 3 !== 0,
    }));

    const draw = () => {
      t += 0.02;
      const w = canvas.width;
      const h = canvas.height;
      const s = stateRef.current;
      const phase = s.round?.phase ?? "idle";
      const ideas = s.round?.ideas.filter((i) => !i.hidden) ?? [];
      const coBuilders = s.coBuilders ?? [];
      const totalShipped = coBuilders.reduce((sum, b) => sum + b.shipped, 0);
      const level = Math.min(4, 1 + totalShipped + (s.stats.rounds > 0 ? 1 : 0));

      // Dusk gradient backdrop
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#121022");
      bg.addColorStop(0.55, "#191530");
      bg.addColorStop(1, "#0b0c12");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Soft warm horizon glow behind workshop
      const glow = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.48, 240);
      glow.addColorStop(0, "rgba(145, 70, 255, 0.28)");
      glow.addColorStop(0.55, "rgba(245, 185, 66, 0.08)");
      glow.addColorStop(1, "rgba(11, 12, 18, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Floating voxel motes
      for (const m of motes) {
        m.y -= m.speed;
        if (m.y < 10) m.y = h - 10;
        ctx.fillStyle = m.violet ? "rgba(181, 137, 255, 0.36)" : "rgba(245, 185, 66, 0.3)";
        ctx.fillRect(m.x, m.y, m.size, m.size);
      }

      const ox = w * 0.5;
      const oy = h * 0.52 + Math.sin(t * 1.1) * 3;
      let blockCount = 0;

      // 1. Floating island stone/earth base + grass terrace (5x5)
      for (let gx = -2; gx <= 2; gx++) {
        for (let gy = -2; gy <= 2; gy++) {
          const edge = Math.abs(gx) === 2 || Math.abs(gy) === 2;
          if (!edge || (gx + gy) % 2 === 0) {
            drawVoxel(ctx, ox, oy, gx, gy, -1, "#4b4657", "#363242", "#282532");
            blockCount++;
          }
          drawVoxel(ctx, ox, oy, gx, gy, 0, "#4b835b", "#3a6547", "#2c4d36");
          blockCount++;
        }
      }

      // 2. Workshop stone foundation & walls (grows with level)
      const wallHeight = level >= 2 ? 2 : 1;
      for (let gz = 1; gz <= wallHeight; gz++) {
        for (let gx = -1; gx <= 1; gx++) {
          for (let gy = -1; gy <= 1; gy++) {
            const isWindow = gz === 1 && ((gx === 0 && gy === 1) || (gx === 1 && gy === 0));
            const top = isWindow ? "#b589ff" : "#77798a";
            const left = isWindow ? "#9146ff" : "#5a5c6c";
            const right = isWindow ? "#6b2cd4" : "#444654";
            drawVoxel(ctx, ox, oy, gx, gy, gz, top, left, right);
            blockCount++;
          }
        }
      }

      // 3. Timber pitched roof (unlocked at level >= 2)
      if (level >= 2) {
        const roofZ = wallHeight + 1;
        for (let gx = -1; gx <= 1; gx++) {
          for (let gy = -1; gy <= 1; gy++) {
            drawVoxel(ctx, ox, oy, gx, gy, roofZ, "#c68b4b", "#9e6b36", "#7a5128");
            blockCount++;
          }
        }
        drawVoxel(ctx, ox, oy, 0, 0, roofZ + 1, "#d99f5e", "#b07a40", "#8a5c2e");
        blockCount++;
      }

      // 4. Crystal spire when executing or level >= 3
      if (level >= 3 || phase === "executing") {
        const spireZ = wallHeight + 3;
        const pulse = phase === "executing" ? "#2FD48A" : "#c79eff";
        drawVoxel(ctx, ox, oy, 0, 0, spireZ, pulse, "#9146ff", "#6b2cd4");
        blockCount++;
      }

      // 5. Co-Builder terrace flags & tree accent
      drawVoxel(ctx, ox, oy, -2, 1, 1, "#5c422c", "#473220", "#362517");
      drawVoxel(ctx, ox, oy, -2, 1, 2, "#3c7c4e", "#2d5e3b", "#22472d");
      blockCount += 2;

      if (coBuilders.length > 0) {
        const flagSlots: [number, number][] = [
          [2, -1],
          [-1, 2],
          [2, 1],
        ];
        coBuilders.slice(0, 3).forEach((b, idx) => {
          const [fx, fy] = flagSlots[idx]!;
          drawVoxel(ctx, ox, oy, fx, fy, 1, "#9146ff", "#7232d6", "#5824ad");
          const sx = ox + (fx - fy) * ISO_X;
          const sy = oy + (fx + fy) * ISO_Y - ISO_Z * 1.4;
          ctx.font = "10px monospace";
          ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
          ctx.fillText(`@${b.login}`, sx + 12, sy);
        });
      }

      // 6. Floating chat !idea speech pills above the island
      const shownIdeas = ideas.slice(-3);
      shownIdeas.forEach((idea, idx) => {
        const bx = w * (0.22 + idx * 0.27);
        const by = 78 + (idx % 2) * 28 + Math.sin(t * 1.6 + idx * 1.7) * 4;
        const label = `@${idea.author.login}: ${truncate(idea.text, 20)}`;
        ctx.font = "11px monospace";
        const tw = ctx.measureText(label).width;
        const pw = tw + 16;
        const ph = 22;

        ctx.fillStyle = idea.boosts ? "rgba(245, 185, 66, 0.18)" : "rgba(18, 21, 32, 0.86)";
        ctx.strokeStyle = idea.boosts ? "rgba(245, 185, 66, 0.7)" : "rgba(145, 70, 255, 0.65)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx - pw / 2, by, pw, ph, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, bx - tw / 2, by + 15);
      });

      // 7. Voxel celebration / click particles
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.life -= 1;
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
        return p.life > 0;
      });

      // Top-left crisp telemetry
      ctx.font = "11px monospace";
      ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
      ctx.fillText(`WORKSHOP // LVL 0${level}`, 16, 26);
      ctx.fillText(`VOXELS // ${blockCount}`, 16, 42);
      ctx.fillText(`PHASE // ${phase.toUpperCase()}`, 16, 58);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={360}
      className="stage-canvas"
      onClick={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
        const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
        spawnBurst(x, y, "#9146FF", 12);
      }}
      title="Click workshop to drop voxel sparks"
    />
  );
}

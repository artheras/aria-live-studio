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

/**
 * Interactive Voxel Workshop Stage: pairs the twilight voxel workshop diorama
 * with live floating Twitch !idea speech bubbles, Co-Builder pins, and click/event particle bursts.
 */
export function LiveStageCanvas({ state }: { state: LiveState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<VoxelParticle[]>([]);
  const lastCelebrationIdRef = useRef<string | null>(null);

  const spawnBurst = (cx: number, cy: number, color: string, count = 16) => {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 1.1 + Math.random() * 2.5;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1.2,
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
    spawnBurst(320, 150, color, 22);
  }, [state.celebrations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.life -= 1;
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
        return p.life > 0;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ideas = (state.round?.ideas.filter((i) => !i.hidden) ?? []).slice(-4);
  const coBuilders = (state.coBuilders ?? []).slice(0, 3);

  return (
    <div
      className="workshop-scene"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 640;
        const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 360;
        spawnBurst(x, y, "#B589FF", 14);
      }}
      title="Click anywhere on the workshop to drop voxel sparks"
    >
      <img className="workshop-scene__art" src="/art/voxel-workshop.jpg" alt="Voxel Workshop Stage" />
      <div className="workshop-scene__vignette" aria-hidden="true" />
      <canvas ref={canvasRef} width={640} height={360} className="workshop-scene__fx" />

      {ideas.map((idea, idx) => (
        <div
          key={idea.id}
          className={`workshop-bubble workshop-bubble--${idx} ${idea.boosts ? "is-boosted" : ""}`}
        >
          <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
          <span className="workshop-bubble__text">{truncate(idea.text, 28)}</span>
          {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
        </div>
      ))}

      {coBuilders.length > 0 && (
        <div className="workshop-cobuilders" aria-label="Workshop Co-Builders">
          {coBuilders.map((b) => (
            <span key={b.login} className="workshop-pin">
              @{b.displayName || b.login} · {b.shipped}×
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

import type { StageDraft } from "./draft";
import { routeStones } from "./routes";
import type { VoxelSpec } from "./voxels";

export function fillIslandBase(d: StageDraft) {
  const {
    u, pushStone, grassSpecs, mossSpecs, dirtSpecs, timberSpecs, stoneDarkSpecs, stoneLightSpecs,
    stoneMidSpecs, scaffSpecs, roofDarkSpecs, pineSpecs, lanternSpecs, windowSpecs, trunkSpecs,
  } = d;

    // Wider floating cliff so the front lawn has room beyond the houses.
    for (let gx = -26; gx <= 26; gx++) {
      for (let gz = -26; gz <= 26; gz++) {
        const x = gx * u;
        const z = gz * u;
        const dist = Math.abs(gx) + Math.abs(gz);
        const maxC = Math.max(Math.abs(gx), Math.abs(gz));
        if (maxC > 26 || dist > 38) continue;

        if ((gx + gz) % 3 === 0) mossSpecs.push({ x, y: 0.04, z });
        else grassSpecs.push({ x, y: 0.0, z });

        if (dist <= 38) dirtSpecs.push({ x, y: -0.5, z });
        if (dist <= 36 && (maxC <= 25 || (gx + gz) % 2 === 0)) pushStone(x, -1.0, z);
        if (dist >= 18 && dist <= 38) {
            stoneMidSpecs.push({ x, y: -0.95, z });
            stoneDarkSpecs.push({ x, y: -1.45, z });
          }
          if (dist <= 21 && maxC <= 14) pushStone(x, -1.5, z);
          if (dist <= 19 && maxC <= 13) stoneDarkSpecs.push({ x, y: -2.0, z });
          if (dist <= 17 && maxC <= 11) pushStone(x, -2.5, z);
          if (dist <= 15 && maxC <= 10) stoneDarkSpecs.push({ x, y: -3.0, z });
          if (dist <= 13 && maxC <= 9) stoneDarkSpecs.push({ x, y: -3.5, z });
          if (dist <= 10 && maxC <= 7) stoneDarkSpecs.push({ x, y: -4.0, z });
          if (dist <= 8 && maxC <= 6) stoneDarkSpecs.push({ x, y: -4.5, z });
          if (dist <= 6 && maxC <= 4) stoneDarkSpecs.push({ x, y: -5.0, z });
          if (dist <= 4 && maxC <= 3) stoneDarkSpecs.push({ x, y: -5.5, z });
          if (dist <= 3) stoneDarkSpecs.push({ x, y: -6.0, z });
          if (dist <= 2) stoneDarkSpecs.push({ x, y: -6.5, z });
        if (dist <= 1) stoneDarkSpecs.push({ x, y: -7.0, z });
      }
    }
    // Irregular corner rock stalactites, hanging moss lips & branched wooden cliff roots
    for (const [rx, rz] of [
      [-6.2, 3.5],
      [6.2, 3.0],
      [3.5, -6.2],
      [-5.2, -5.2],
      [0.0, 6.8],
      [-3.2, 6.2],
      [4.8, 5.0],
      [-6.8, -1.0],
      [6.8, -1.5],
      [0.2, 0.2],
    ] as const) {
      stoneDarkSpecs.push({ x: rx, y: -2.5, z: rz, sx: 1.5, sy: 3.0, sz: 1.5 });
      mossSpecs.push({ x: rx, y: -0.45, z: rz, sx: 1.1, sy: 1.4, sz: 1.1 });
    }
    // Branched primary + secondary roots dangling below the wider floating island
    for (const [vx, vz, len] of [
      [-6.2, 3.8, 5],
      [-5.0, 5.2, 6],
      [-3.2, 6.4, 5],
      [-1.0, 7.0, 4],
      [1.6, 6.8, 6],
      [3.8, 5.8, 5],
      [5.8, 4.0, 6],
      [6.8, 1.6, 4],
      [-6.8, 1.2, 5],
      [0.4, 5.0, 6],
      [-7.6, -2.2, 6],
      [7.4, -3.0, 6],
      [-4.6, -5.4, 5],
      [2.4, -6.2, 5],
      [-8.0, 4.8, 5],
      [7.8, 5.4, 5],
      [0.2, -7.2, 4],
      [-2.4, 7.6, 5],
    ] as const) {
      for (let k = 0; k < len; k++) {
        timberSpecs.push({
          x: vx + (k % 2) * 0.1,
          y: -1.6 - k * 0.46,
          z: vz,
          sx: k < 2 ? 0.36 : 0.22,
          sy: 0.98,
          sz: k < 2 ? 0.36 : 0.22,
        });
        if (k === 2 || k === 4) {
          timberSpecs.push({
            x: vx + (k === 2 ? 0.26 : -0.24),
            y: -1.75 - k * 0.46,
            z: vz + 0.14,
            sx: 0.18,
            sy: 0.85,
            sz: 0.18,
          });
        }
      }
      mossSpecs.push({ x: vx, y: -0.95, z: vz, sx: 0.55, sy: 1.1, sz: 0.55 });
    }
    for (const [x, z] of [
        [-6.4, 4.2],
        [-4.8, 6.6],
        [-2.2, 8.2],
        [0.4, 8.6],
        [2.8, 7.8],
        [5.2, 6.4],
        [6.6, 3.4],
        [6.2, -1.2],
        [-6.6, -1.4],
        [-1.2, -6.4],
        [2.4, -6.2],
      ] as const) {
        windowSpecs.push(
          { x, y: -2.4, z, sx: 0.28, sy: 4.2, sz: 0.28 },
          { x: x + 0.2, y: -3.8, z: z + 0.08, sx: 0.18, sy: 2.8, sz: 0.18 },
          { x: x - 0.12, y: -4.8, z: z - 0.06, sx: 0.14, sy: 1.8, sz: 0.14 },
        );
      }
      const terrace = (x: number, z: number, layers: number, reach: number) => {
        for (let layer = 0; layer < layers; layer++) {
          const y = 0.28 + layer * 0.46;
          for (let ix = -reach; ix <= reach; ix++) {
            for (let iz = -reach; iz <= reach; iz++) {
              if (Math.abs(ix) + Math.abs(iz) > reach + 1) continue;
              pushStone(x + ix * 0.5, y, z + iz * 0.5);
            }
          }
        }
      };
      terrace(-4.4, 4.3, 1, 3);
      terrace(-8.8, 0.2, 2, 3);
      terrace(9.0, 0.2, 3, 3);
      terrace(-2.4, -8.8, 2, 3);
      terrace(4.6, -8.8, 1, 3);
      terrace(0.15, -1.0, 3, 4);
    // 7. Spacious Pine Groves, Workbench, Wishing Well, Plaza Cobblestones & Shrubs
    trunkSpecs.push(
      { x: -8.2, y: 0.8, z: 1.8, sx: 0.42, sy: 2.1, sz: 0.42 },
      { x: 8.0, y: 0.7, z: 2.6, sx: 0.38, sy: 1.8, sz: 0.38 },
      { x: -8.0, y: 0.65, z: -3.2, sx: 0.36, sy: 1.6, sz: 0.36 },
      { x: 7.8, y: 0.7, z: -3.4, sx: 0.38, sy: 1.8, sz: 0.38 },
    );
    const addFineTree = (cx: number, baseY: number, cz: number, tiers: number) => {
      for (let t = 0; t < tiers; t++) {
        const r = tiers - t;
        const y = baseY + t * 0.44;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
            const target = (dx + dz + t) % 3 === 0 ? mossSpecs : pineSpecs;
            target.push({
              x: cx + dx * 0.36,
              y: y + ((dx * dz) % 2) * 0.06,
              z: cz + dz * 0.36,
              sx: 0.62,
              sy: 0.7,
              sz: 0.62,
            });
          }
        }
      }
      pineSpecs.push({ x: cx, y: baseY + tiers * 0.44, z: cz, sx: 0.75, sy: 0.85, sz: 0.75 });
    };
    addFineTree(-10.2, 0.85, 3.8, 2);
    addFineTree(10.0, 0.8, 3.6, 2);
    addFineTree(-10.4, 0.75, -5.2, 2);
    addFineTree(10.2, 0.75, -4.6, 2);
    const addFlowerTree = (cx: number, cz: number) => {
      timberSpecs.push({ x: cx, y: 0.7, z: cz, sx: 0.32, sy: 2.2, sz: 0.32 });
      addFineTree(cx, 1.45, cz, 2);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const x = cx + Math.cos(ang) * 0.55;
        const z = cz + Math.sin(ang) * 0.55;
        const y = 1.7 + (i % 3) * 0.28;
        const spec = { x, y, z, sx: 0.22, sy: 0.2, sz: 0.22 };
        if (i % 3 === 0) d.blossomPinkSpecs.push(spec);
        else if (i % 3 === 1) d.blossomGoldSpecs.push(spec);
        else d.blossomWhiteSpecs.push(spec);
      }
    };
    addFlowerTree(-9.4, 7.4);
    addFlowerTree(8.6, 8.2);
    addFlowerTree(-9.2, -7.6);
    addFlowerTree(8.8, -8.0);

    // Rounded bushes, each made of a few small leaves rather than one cube.
    const addBush = (cx: number, cz: number, s = 1) => {
      const puffs: VoxelSpec[] = [
        { x: cx, y: 0.32 * s, z: cz, sx: 0.55 * s, sy: 0.42 * s, sz: 0.5 * s },
        { x: cx - 0.22 * s, y: 0.28 * s, z: cz + 0.12 * s, sx: 0.38 * s, sy: 0.32 * s, sz: 0.36 * s },
        { x: cx + 0.2 * s, y: 0.36 * s, z: cz - 0.08 * s, sx: 0.36 * s, sy: 0.34 * s, sz: 0.34 * s },
        { x: cx + 0.05 * s, y: 0.48 * s, z: cz + 0.02 * s, sx: 0.32 * s, sy: 0.26 * s, sz: 0.3 * s },
      ];
      for (const p of puffs) mossSpecs.push(p);
    };
    for (const [sx, sz] of [
      [-4.4, 2.4],
      [2.9, 2.4],
      [-4.6, 3.6],
      [3.4, 3.3],
      [2.2, 5.6],
      [-4.8, 5.2],
      [3.8, 3.9],
    ] as const) {
      addBush(sx, sz, 0.85);
    }
    // Left-foreground stone wishing well + wooden canopy (spaciously placed)
    stoneMidSpecs.push({ x: -4.2, y: 0.36, z: 4.4, sx: 1.35, sy: 0.72, sz: 1.35 });
    timberSpecs.push(
      { x: -4.5, y: 0.92, z: 4.4, sx: 0.14, sy: 1.05, sz: 0.14 },
      { x: -3.9, y: 0.92, z: 4.4, sx: 0.14, sy: 1.05, sz: 0.14 },
    );
    roofDarkSpecs.push({ x: -4.2, y: 1.38, z: 4.4, sx: 1.6, sy: 0.36, sz: 1.3 });
    scaffSpecs.push(
      { x: -2.35, y: 0.2, z: 2.25, sx: 1.35, sy: 0.16, sz: 0.6 },
      { x: 0.55, y: 0.2, z: 2.4, sx: 1.2, sy: 0.16, sz: 0.55 },
    );

    for (const [x, z] of [
      [-2.6, 2.15],
      [-2.15, 2.35],
      [-2.4, 2.05],
      [0.35, 2.3],
      [0.7, 2.5],
      [0.5, 2.15],
    ] as const) {
      mossSpecs.push({ x, y: 0.22, z, sx: 0.28, sy: 0.16, sz: 0.28 });
    }

    // Extended stepping stones toward right-side workbench & MCP Relay Beacon
    for (const [cx, cz] of [
      [3.05, 4.8],
      [3.8, 4.95],
      [4.7, 5.1],
      [5.4, 4.85],
    ] as const) {
      stoneLightSpecs.push({ x: cx, y: 0.16, z: cz, sx: 0.68, sy: 0.14, sz: 0.52 });
    }

    // Right-foreground Git Worktree Workbench, Anvil & Supply Crates (x: 3.9..5.2, z: 4.3..5.6)
    timberSpecs.push(
      { x: 4.15, y: 0.34, z: 4.55, sx: 0.16, sy: 0.44, sz: 0.16 },
      { x: 4.85, y: 0.34, z: 4.55, sx: 0.16, sy: 0.44, sz: 0.16 },
      { x: 4.15, y: 0.34, z: 5.05, sx: 0.16, sy: 0.44, sz: 0.16 },
      { x: 4.85, y: 0.34, z: 5.05, sx: 0.16, sy: 0.44, sz: 0.16 },
    );
    scaffSpecs.push({ x: 4.5, y: 0.62, z: 4.8, sx: 1.05, sy: 0.14, sz: 0.78 });
    lanternSpecs.push({ x: 4.78, y: 0.78, z: 4.72, sx: 0.2, sy: 0.18, sz: 0.2 });
    // Anvil + supply crate beside workbench
    stoneDarkSpecs.push(
      { x: 3.65, y: 0.28, z: 4.1, sx: 0.52, sy: 0.24, sz: 0.36 },
      { x: 3.65, y: 0.48, z: 4.1, sx: 0.68, sy: 0.18, sz: 0.42 },
    );
    // Purple-trimmed supply crate
    roofDarkSpecs.push({ x: 5.2, y: 0.4, z: 5.55, sx: 0.74, sy: 0.56, sz: 0.74 });
    scaffSpecs.push({ x: 5.2, y: 0.7, z: 5.55, sx: 0.78, sy: 0.08, sz: 0.78 });

    // MCP Relay Beacon Tower (x: 5.95, z: 4.55)
    stoneMidSpecs.push(
      { x: 5.95, y: 0.28, z: 4.55, sx: 1.15, sy: 0.28, sz: 1.15 },
      { x: 5.95, y: 0.56, z: 4.55, sx: 0.82, sy: 0.28, sz: 0.82 },
    );
    timberSpecs.push(
      { x: 5.7, y: 1.25, z: 4.3, sx: 0.14, sy: 1.3, sz: 0.14 },
      { x: 6.2, y: 1.25, z: 4.3, sx: 0.14, sy: 1.3, sz: 0.14 },
      { x: 5.7, y: 1.25, z: 4.8, sx: 0.14, sy: 1.3, sz: 0.14 },
      { x: 6.2, y: 1.25, z: 4.8, sx: 0.14, sy: 1.3, sz: 0.14 },
    );
    scaffSpecs.push({ x: 5.95, y: 1.9, z: 4.55, sx: 0.76, sy: 0.14, sz: 0.76 });

    // Left-foreground Live Ballot & Idea Totem Base (x: -5.5, z: 5.3) + Community Bench (x: -2.2, z: 5.9)
    stoneMidSpecs.push(
      { x: -5.5, y: 0.26, z: 5.3, sx: 1.55, sy: 0.24, sz: 1.15 },
      { x: -5.5, y: 0.44, z: 5.3, sx: 1.25, sy: 0.14, sz: 0.85 },
    );
    timberSpecs.push(
      { x: -2.55, y: 0.26, z: 5.85, sx: 0.14, sy: 0.26, sz: 0.36 },
      { x: -1.85, y: 0.26, z: 5.85, sx: 0.14, sy: 0.26, sz: 0.36 },
    );
    scaffSpecs.push({ x: -2.2, y: 0.42, z: 5.85, sx: 1.05, sy: 0.1, sz: 0.42 });

    // Three warm stone path lanterns
    for (const [lx, lz] of [
      [-3.15, 5.25],
      [2.45, 5.45],
      [5.25, 3.55],
    ] as const) {
      stoneMidSpecs.push({ x: lx, y: 0.34, z: lz, sx: 0.28, sy: 0.44, sz: 0.28 });
      lanternSpecs.push({ x: lx, y: 0.68, z: lz, sx: 0.24, sy: 0.24, sz: 0.24 });
      stoneDarkSpecs.push({ x: lx, y: 0.86, z: lz, sx: 0.38, sy: 0.12, sz: 0.38 });
    }

    // Amethyst crystal clusters around island rim
    for (const [cx, cz, ch] of [
      [-5.95, 4.15, 0.62],
      [-5.65, 4.35, 0.42],
      [-4.6, 6.15, 0.56],
      [4.55, 6.25, 0.58],
      [6.45, 3.65, 0.64],
      [6.15, 3.85, 0.4],
    ] as const) {
      windowSpecs.push({ x: cx, y: 0.14 + ch * 0.5, z: cz, sx: 0.26, sy: ch, sz: 0.26 });
    }

    // House plot. Every house opens near x=-1.25, z=1.7. The fence and path stay with the base.
    const fencePost = (x: number, z: number) => {
      timberSpecs.push({ x, y: 0.42, z, sx: 0.14, sy: 0.62, sz: 0.14 });
    };
    for (const x of [-3.6, -2.9, 0.5, 1.3, 2.1]) fencePost(x, 6.35);
    for (const z of [2.6, 3.5, 4.4, 5.3]) {
      fencePost(-3.7, z);
      fencePost(2.2, z);
    }
    scaffSpecs.push(
      { x: -3.25, y: 0.62, z: 6.35, sx: 0.9, sy: 0.1, sz: 0.1 },
      { x: 1.3, y: 0.62, z: 6.35, sx: 1.8, sy: 0.1, sz: 0.1 },
      { x: -3.7, y: 0.62, z: 4.4, sx: 0.1, sy: 0.1, sz: 3.4 },
      { x: 2.2, y: 0.62, z: 4.4, sx: 0.1, sy: 0.1, sz: 3.4 },
    );

    for (const [cx, cz] of [
        [0.55, 2.4],
        [0.55, 3.3],
        [0.55, 4.2],
        [0.55, 5.1],
        [0.55, 6.0],
        [0.55, 6.9],
        [0.55, 7.8],
        [0.55, 8.8],
        [0.55, 9.8],
        [0.55, 10.8],
      ] as const) {
        stoneLightSpecs.push({ x: cx, y: 0.18, z: cz, sx: 1.45, sy: 0.2, sz: 1.15 });
        stoneMidSpecs.push({ x: cx + 0.35, y: 0.14, z: cz, sx: 0.55, sy: 0.14, sz: 0.7 });
        timberSpecs.push(
          { x: -1.15, y: 0.42, z: cz, sx: 0.12, sy: 0.62, sz: 0.12 },
          { x: 1.85, y: 0.42, z: cz, sx: 0.12, sy: 0.62, sz: 0.12 },
        );
        d.blossomPinkSpecs.push({ x: -1.45, y: 0.36, z: cz + 0.2, sx: 0.22, sy: 0.18, sz: 0.22 });
        d.blossomGoldSpecs.push({ x: 2.15, y: 0.36, z: cz - 0.15, sx: 0.18, sy: 0.16, sz: 0.18 });
      }
      timberSpecs.push(
        { x: -1.15, y: 0.62, z: 5.1, sx: 0.1, sy: 0.1, sz: 5.6 },
        { x: 1.85, y: 0.62, z: 5.1, sx: 0.1, sy: 0.1, sz: 5.6 },
      );

    // Idea post sits left of the path so the front door stays open.
    timberSpecs.push(
      { x: -6.2, y: 0.95, z: 10.2, sx: 0.28, sy: 3.5, sz: 0.28 },
      { x: -6.2, y: 1.72, z: 10.2, sx: 0.16, sy: 0.9, sz: 0.16 },
    );
    scaffSpecs.push(
      { x: -6.2, y: 1.15, z: 10.45, sx: 1.15, sy: 0.85, sz: 0.72 },
      { x: -6.2, y: 1.58, z: 10.45, sx: 1.25, sy: 0.16, sz: 0.82 },
    );
    roofDarkSpecs.push({ x: -6.2, y: 1.78, z: 10.45, sx: 1.55, sy: 0.18, sz: 1.05 });
    lanternSpecs.push({ x: -5.8, y: 1.95, z: 10.45, sx: 0.22, sy: 0.42, sz: 0.12 });
    stoneMidSpecs.push({ x: -6.2, y: 0.22, z: 10.2, sx: 0.85, sy: 0.22, sz: 0.85 });

    // Vote kiosk on the new front lawn. Live bars stand in front of this roof.
    timberSpecs.push(
      { x: -0.75, y: 1.05, z: 11.6, sx: 0.24, sy: 3.4, sz: 0.24 },
      { x: 1.15, y: 1.05, z: 11.6, sx: 0.24, sy: 3.4, sz: 0.24 },
    );
    roofDarkSpecs.push({ x: 0.2, y: 1.15, z: 11.5, sx: 2.6, sy: 1.7, sz: 0.16 });
    scaffSpecs.push({ x: 0.2, y: 1.85, z: 11.65, sx: 2.9, sy: 0.16, sz: 0.55 });
    roofDarkSpecs.push({ x: 0.2, y: 2.05, z: 11.55, sx: 3.2, sy: 0.16, sz: 1.05 });
    stoneMidSpecs.push({ x: 0.2, y: 0.18, z: 11.55, sx: 3.3, sy: 0.2, sz: 1.15 });

    // Plan desk: a table the approved task sits on, with two stools.
    timberSpecs.push(
      { x: 4.35, y: 0.42, z: 10.15, sx: 0.22, sy: 1.15, sz: 0.22 },
      { x: 5.45, y: 0.42, z: 10.15, sx: 0.22, sy: 1.15, sz: 0.22 },
      { x: 4.35, y: 0.42, z: 10.85, sx: 0.22, sy: 1.15, sz: 0.22 },
      { x: 5.45, y: 0.42, z: 10.85, sx: 0.22, sy: 1.15, sz: 0.22 },
    );
    scaffSpecs.push({ x: 4.9, y: 0.72, z: 10.5, sx: 2.7, sy: 0.18, sz: 1.7 });
    timberSpecs.push(
      { x: 4.15, y: 1.15, z: 10.0, sx: 0.16, sy: 1.5, sz: 0.16 },
      { x: 5.65, y: 1.15, z: 10.0, sx: 0.16, sy: 1.5, sz: 0.16 },
      { x: 4.15, y: 1.15, z: 11.0, sx: 0.16, sy: 1.5, sz: 0.16 },
      { x: 5.65, y: 1.15, z: 11.0, sx: 0.16, sy: 1.5, sz: 0.16 },
    );
    roofDarkSpecs.push({ x: 4.9, y: 1.85, z: 10.5, sx: 3.2, sy: 0.16, sz: 2.15 });
    stoneMidSpecs.push({ x: 4.9, y: 0.14, z: 10.5, sx: 3.1, sy: 0.16, sz: 2.0 });
    stoneLightSpecs.push(
      { x: 4.65, y: 0.88, z: 10.35, sx: 0.7, sy: 0.08, sz: 0.5 },
      { x: 5.15, y: 0.9, z: 10.65, sx: 0.55, sy: 0.08, sz: 0.4 },
    );
    timberSpecs.push(
      { x: 4.45, y: 0.38, z: 9.65, sx: 0.55, sy: 0.7, sz: 0.55 },
      { x: 5.45, y: 0.38, z: 9.65, sx: 0.55, sy: 0.7, sz: 0.55 },
    );

    // Build stall: an open shed with crates, a tool rack, and a water trough.
    timberSpecs.push(
      { x: 6.6, y: 0.95, z: 10.4, sx: 0.28, sy: 3.4, sz: 0.28 },
      { x: 8.0, y: 0.95, z: 10.4, sx: 0.28, sy: 3.4, sz: 0.28 },
      { x: 6.6, y: 0.95, z: 11.4, sx: 0.28, sy: 3.4, sz: 0.28 },
      { x: 8.0, y: 0.95, z: 11.4, sx: 0.28, sy: 3.4, sz: 0.28 },
    );
    scaffSpecs.push({ x: 7.3, y: 1.72, z: 10.9, sx: 3.4, sy: 0.18, sz: 2.6 });
    roofDarkSpecs.push({ x: 7.3, y: 1.88, z: 10.9, sx: 3.8, sy: 0.16, sz: 2.9 });
    scaffSpecs.push(
      { x: 6.9, y: 0.42, z: 10.65, sx: 0.85, sy: 0.7, sz: 0.85 },
      { x: 7.55, y: 0.48, z: 10.5, sx: 0.7, sy: 0.55, sz: 0.7 },
      { x: 7.15, y: 0.95, z: 10.55, sx: 0.45, sy: 0.4, sz: 0.45 },
    );
    stoneMidSpecs.push(
      { x: 7.3, y: 0.16, z: 10.9, sx: 3.8, sy: 0.18, sz: 2.8 },
      { x: 7.65, y: 0.32, z: 11.3, sx: 1.4, sy: 0.42, sz: 0.65 },
    );
    timberSpecs.push(
      { x: 8.3, y: 1.25, z: 10.3, sx: 0.26, sy: 2.2, sz: 0.26 },
      { x: 8.3, y: 2.25, z: 11.1, sx: 0.2, sy: 0.2, sz: 1.8 },
      { x: 8.3, y: 1.55, z: 11.4, sx: 0.12, sy: 1.3, sz: 0.12 },
    );
    scaffSpecs.push(
      { x: 8.3, y: 1.05, z: 10.3, sx: 1.05, sy: 0.75, sz: 1.05 },
      { x: 8.45, y: 0.9, z: 11.4, sx: 0.5, sy: 0.45, sz: 0.5 },
    );

    // Two kitchen gardens breaking up the left lawn.
    for (const [bx, bz] of [
      [-6.4, 6.4],
      [-6.55, 7.7],
    ] as const) {
      dirtSpecs.push({ x: bx, y: 0.16, z: bz, sx: 2.5, sy: 0.22, sz: 1.45 });
      timberSpecs.push(
        { x: bx, y: 0.28, z: bz - 0.62, sx: 2.6, sy: 0.16, sz: 0.14 },
        { x: bx, y: 0.28, z: bz + 0.62, sx: 2.6, sy: 0.16, sz: 0.14 },
        { x: bx - 1.15, y: 0.28, z: bz, sx: 0.14, sy: 0.16, sz: 1.35 },
        { x: bx + 1.15, y: 0.28, z: bz, sx: 0.14, sy: 0.16, sz: 1.35 },
      );
      for (let i = -1; i <= 1; i++) {
        mossSpecs.push({ x: bx + i * 0.55, y: 0.34, z: bz, sx: 0.28, sy: 0.32, sz: 0.28 });
      }
    }

    for (const [sx, sz, sc] of [
      [-7.4, 3.2, 1.15],
      [7.6, 3.4, 1.1],
      [-7.2, 1.2, 1.2],
      [7.8, 2.2, 1.1],
      [-0.8, 8.3, 1.3],
      [2.4, 8.15, 1.2],
    ] as const) {
      addBush(sx, sz, sc);
    }

  for (const [x, z] of [[-3.35, 5.15], [1.85, 5.35]] as const) {
    stoneMidSpecs.push({ x, y: 0.48, z, sx: 0.24, sy: 0.78, sz: 0.24 });
    lanternSpecs.push({ x, y: 0.95, z, sx: 0.3, sy: 0.34, sz: 0.3 });
    stoneDarkSpecs.push({ x, y: 1.16, z, sx: 0.42, sy: 0.12, sz: 0.42 });
  }
  d.blossomPinkSpecs.push(
    { x: -3.15, y: 0.4, z: 2.35, sx: 0.24, sy: 0.22, sz: 0.24 },
    { x: 0.7, y: 0.4, z: 2.45, sx: 0.22, sy: 0.2, sz: 0.22 },
    { x: -4.7, y: 0.52, z: 6.7, sx: 0.28, sy: 0.24, sz: 0.28 },
    { x: -3.6, y: 0.5, z: 6.85, sx: 0.24, sy: 0.22, sz: 0.24 },
    { x: -4.15, y: 0.54, z: 8.15, sx: 0.26, sy: 0.22, sz: 0.26 },
    { x: -4.7, y: 0.5, z: 7.95, sx: 0.22, sy: 0.2, sz: 0.22 },
    { x: -3.4, y: 0.42, z: 6.15, sx: 0.24, sy: 0.2, sz: 0.24 },
    { x: 0.85, y: 0.42, z: 6.2, sx: 0.22, sy: 0.2, sz: 0.22 },
  );
  d.blossomGoldSpecs.push(
    { x: -3.4, y: 0.4, z: 2.15, sx: 0.2, sy: 0.18, sz: 0.2 },
    { x: 0.95, y: 0.4, z: 2.2, sx: 0.18, sy: 0.16, sz: 0.18 },
    { x: -3.85, y: 0.52, z: 6.55, sx: 0.22, sy: 0.2, sz: 0.22 },
    { x: -4.45, y: 0.5, z: 8.25, sx: 0.2, sy: 0.18, sz: 0.2 },
    { x: 1.55, y: 0.46, z: 6.35, sx: 0.2, sy: 0.18, sz: 0.2 },
  );
  d.blossomWhiteSpecs.push(
    { x: -3.0, y: 0.4, z: 2.55, sx: 0.16, sy: 0.16, sz: 0.16 },
    { x: 0.55, y: 0.4, z: 2.6, sx: 0.16, sy: 0.16, sz: 0.16 },
    { x: 1.4, y: 0.42, z: 7.2, sx: 0.18, sy: 0.16, sz: 0.18 },
  );
  for (const [x, z] of [
    [-2.4, 6.9],
    [-3.6, 7.5],
    [-4.6, 7.7],
    [1.2, 7.3],
    [2.4, 7.7],
    [4.2, 7.4],
  ] as const) {
    stoneLightSpecs.push({ x, y: 0.16, z, sx: 1.05, sy: 0.16, sz: 0.8 });
    d.blossomPinkSpecs.push({ x: x - 0.7, y: 0.36, z: z + 0.15, sx: 0.22, sy: 0.18, sz: 0.22 });
    d.blossomGoldSpecs.push({ x: x + 0.65, y: 0.36, z: z - 0.1, sx: 0.18, sy: 0.16, sz: 0.18 });
  }
  for (const [x, z] of [
    [-4.2, 8.4],
    [-1.6, 8.8],
    [0.8, 8.6],
    [3.2, 8.2],
    [5.4, 7.5],
  ] as const) {
    mossSpecs.push(
      { x, y: -0.45, z, sx: 0.26, sy: 1.6, sz: 0.26 },
      { x: x + 0.16, y: -1.05, z: z + 0.08, sx: 0.2, sy: 1.15, sz: 0.2 },
    );
    d.blossomPinkSpecs.push({ x, y: -0.85, z, sx: 0.18, sy: 0.18, sz: 0.18 });
    d.blossomGoldSpecs.push({ x: x + 0.1, y: -1.25, z: z + 0.05, sx: 0.16, sy: 0.16, sz: 0.16 });
  }

  for (const [x, z] of routeStones()) {
    stoneLightSpecs.push({ x, y: 0.12, z, sx: 1.05, sy: 0.16, sz: 0.82 });
  }
}

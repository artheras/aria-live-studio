import type { StageDraft } from "./draft";
import { routeStones } from "./routes";
import type { VoxelSpec } from "./voxels";

export function fillIslandBase(d: StageDraft) {
  const {
    u,
    pushStone,
    grassSpecs,
    mossSpecs,
    dirtSpecs,
    timberSpecs,
    stoneDarkSpecs,
    stoneLightSpecs,
    stoneMidSpecs,
    scaffSpecs,
    roofDarkSpecs,
    pineSpecs,
    lanternSpecs,
    windowSpecs,
    trunkSpecs,
  } = d;

  // Deterministic pseudo-noise helper for craggy stalactites & natural moss variation
  const hash2 = (x: number, z: number) => {
    const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  // 1. Expanded Multi-Tiered Island Surface (Radius 17.8, ~80% larger area) + Deep Tapered V-Cone Basalt Underbelly
  for (let gx = -35; gx <= 35; gx++) {
    for (let gz = -35; gz <= 35; gz++) {
      const x = gx * u;
      const z = gz * u;
      const dist = Math.abs(gx) + Math.abs(gz);
      const maxC = Math.max(Math.abs(gx), Math.abs(gz));
      const rad = Math.hypot(x, z);
      const edgeNoise = (hash2(gx, gz) - 0.5) * 2.8;
      if (maxC > 34 || dist > 48 + edgeNoise || rad > 17.8 + edgeNoise * 0.55) continue;

      const hNoise = hash2(gx * 1.7, gz * 1.3);
      // Natural gentle rise toward the central/northern acropolis & outer cliff berm
      const hillLift =
        rad < 7.5 && z < 2.5
          ? 0.28
          : rad < 11.5 && z < 3.5
            ? 0.14
            : rad > 15.2
              ? 0.08
              : 0.0;
      const tileScale = 1.08;
      const surfaceY = hillLift + (hNoise - 0.5) * 0.08;
      if ((gx * 3 + gz * 5) % 4 === 0) {
        mossSpecs.push({ x, y: surfaceY + 0.02, z, sx: tileScale, sy: 0.92, sz: tileScale });
      } else if ((gx + gz) % 7 === 0) {
        pineSpecs.push({ x, y: surfaceY - 0.02, z, sx: tileScale, sy: 0.88, sz: tileScale });
      } else {
        grassSpecs.push({ x, y: surfaceY, z, sx: tileScale, sy: 0.9, sz: tileScale });
      }

      dirtSpecs.push({ x, y: surfaceY - 0.42, z, sx: 1.06, sy: 0.95, sz: 1.06 });

      // Tapered Inverted-Pyramid V-Profile across the 17.8-radius expanse (deep craggy cliff rim + towering central spire)
      const normR = Math.min(1, rad / 17.8);
      const angle = Math.atan2(z, x);
      const rimCrag =
        Math.pow(Math.max(0, Math.sin(angle * 9 + 0.5)), 2) * 2.4 +
        Math.pow(Math.max(0, Math.cos(angle * 13 - 0.7)), 2) * 1.8;
      const taper = Math.pow(1 - normR, 1.18);
      const coneDepth = taper * 11.2;
      // Secondary stalactite sub-peaks at mid and outer-mid rings for dramatic craggy teeth
      const subSpire =
        Math.max(
          0,
          1 - Math.hypot(x + 6.8, z - 6.6) / 4.2,
          1 - Math.hypot(x - 6.8, z - 6.4) / 4.2,
          1 - Math.hypot(x + 2.4, z - 9.8) / 3.8,
          1 - Math.hypot(x - 2.6, z - 9.6) / 3.8,
          1 - Math.hypot(x - 9.8, z - 2.4) / 3.8,
          1 - Math.hypot(x + 9.6, z - 2.4) / 3.8,
          1 - Math.hypot(x + 10.6, z - 6.2) / 3.2,
          1 - Math.hypot(x - 10.4, z - 6.0) / 3.2,
        ) * 4.2;
      const crag = (hash2(gx * 1.3, gz * 1.3) * 0.65 + hash2(gx * 2.9, gz * 2.9) * 0.35) * (1.8 + taper * 2.2);
      const totalDepth = Math.max(1.4, coneDepth + subSpire + rimCrag * (1 - normR * 0.35) + crag);

      const layers = Math.ceil(totalDepth / 0.54);
      for (let ly = 1; ly <= layers; ly++) {
        const y = -0.42 - ly * 0.54;
        const jx = (hash2(gx + ly * 3.1, gz) - 0.5) * 0.14;
        const jz = (hash2(gx, gz + ly * 3.1) - 0.5) * 0.14;
        const scXZ = ly === layers ? 0.66 : ly >= layers - 1 ? 0.82 : 0.96;
        const scY = ly === layers ? 1.52 : 1.14;
        if (ly === layers && layers >= 3) {
          stoneDarkSpecs.push({ x: x + jx, y: y - 0.18, z: z + jz, sx: scXZ, sy: scY, sz: scXZ });
        } else if ((gx * 3 + gz * 5 + ly) % 3 === 0) {
          stoneMidSpecs.push({ x: x + jx, y, z: z + jz, sx: scXZ, sy: scY, sz: scXZ });
        } else if ((gx + gz + ly) % 5 === 0) {
          stoneLightSpecs.push({ x: x + jx, y, z: z + jz, sx: scXZ * 0.92, sy: scY * 0.95, sz: scXZ * 0.92 });
        } else {
          stoneDarkSpecs.push({ x: x + jx, y, z: z + jz, sx: scXZ, sy: scY, sz: scXZ });
        }
      }
    }
  }

  // 1b. Three Detached Floating Crystal Satellite Islets flanking the Main Island
  const addFloatingIslet = (cx: number, cy: number, cz: number, r: number) => {
    for (let dx = -r; dx <= r; dx += 0.5) {
      for (let dz = -r; dz <= r; dz += 0.5) {
        const d2 = Math.hypot(dx, dz);
        if (d2 > r) continue;
        const x = cx + dx;
        const z = cz + dz;
        grassSpecs.push({ x, y: cy, z, sx: 1.05, sy: 0.85, sz: 1.05 });
        const depth = Math.ceil((1 - d2 / r) * 4.5 + hash2(x, z) * 1.5);
        for (let k = 1; k <= depth; k++) {
          stoneDarkSpecs.push({ x, y: cy - k * 0.48, z, sx: k === depth ? 0.65 : 0.92, sy: 1.1, sz: k === depth ? 0.65 : 0.92 });
        }
      }
    }
    windowSpecs.push(
      { x: cx, y: cy - r * 1.4, z: cz, sx: 0.78, sy: 2.8, sz: 0.78 },
      { x: cx + 0.25, y: cy - r * 1.6, z: cz + 0.2, sx: 0.52, sy: 2.1, sz: 0.52 },
    );
    for (let k = 0; k < 6; k++) {
      windowSpecs.push({ x: cx, y: cy - r * 1.9 - k * 0.52, z: cz, sx: 0.22, sy: 0.48, sz: 0.22 });
    }
  };
  addFloatingIslet(-18.2, -1.8, 5.4, 2.0);
  addFloatingIslet(18.0, -2.4, 4.6, 1.8);
  addFloatingIslet(-14.6, -5.2, 12.4, 1.5);

  // 2. 28 Embedded Glowing Amethyst Geode Clusters & Vertical Falling Starlight Streams across the Expanded Under-Cone
  const crystalVeins: ReadonlyArray<readonly [number, number, number, number, boolean]> = [
    // Outer Rim Overhang Geodes (protruding directly from the visible camera-facing basalt cliffs)
    [-13.4, -2.4, 7.6, 3.6, true],
    [-11.2, -2.8, 10.8, 4.0, true],
    [-8.0, -3.2, 13.4, 4.4, true],
    [-4.2, -3.4, 15.0, 4.6, true],
    [0.0, -3.5, 15.6, 4.8, true],
    [4.2, -3.4, 15.0, 4.6, true],
    [8.2, -3.2, 13.2, 4.4, true],
    [11.4, -2.8, 10.6, 4.0, true],
    [13.8, -2.4, 7.2, 3.6, true],
    [15.2, -2.1, 2.8, 3.2, true],
    // Mid-Outer Stalactite Geodes (radius ~ 9.5..12.5)
    [-9.4, -4.6, 7.4, 4.4, true],
    [-6.4, -5.2, 10.2, 4.8, true],
    [-2.4, -5.6, 11.4, 5.2, true],
    [2.4, -5.6, 11.2, 5.2, true],
    [6.6, -5.2, 9.8, 4.8, true],
    [10.0, -4.6, 6.8, 4.4, true],
    [11.8, -4.0, 2.6, 4.0, true],
    // Mid-Inner Stalactite Geodes (radius ~ 5.5..8.5)
    [-5.6, -7.0, 5.8, 4.8, true],
    [-2.0, -7.6, 7.2, 5.2, true],
    [2.2, -7.6, 7.0, 5.2, true],
    [5.8, -6.8, 5.4, 4.8, true],
    [7.4, -6.2, 2.0, 4.4, true],
    // Deep Central Spire Geodes (y = -8.8..-10.6)
    [-2.2, -9.0, 3.0, 5.2, true],
    [2.4, -8.8, 3.0, 5.2, true],
    [0.1, -10.4, 1.4, 5.8, true],
  ];
  for (const [cx, cy, cz, ch, hasStream] of crystalVeins) {
    windowSpecs.push(
      { x: cx, y: cy, z: cz, sx: 0.96, sy: ch, sz: 0.96 },
      { x: cx + 0.38, y: cy - 0.35, z: cz + 0.25, sx: 0.7, sy: ch * 0.82, sz: 0.7 },
      { x: cx - 0.34, y: cy - 0.28, z: cz + 0.22, sx: 0.66, sy: ch * 0.76, sz: 0.66 },
      { x: cx + 0.15, y: cy + 0.35, z: cz + 0.4, sx: 0.58, sy: ch * 0.65, sz: 0.58 },
    );
    if (hasStream) {
      const tipY = cy - ch * 0.28;
      const dropCount = 11 + (Math.abs(Math.round(cx * 3 + cz)) % 5);
      for (let k = 0; k < dropCount; k++) {
        const dy = tipY - 0.42 - k * 0.54;
        const size = Math.max(0.16, 0.4 - k * 0.022);
        windowSpecs.push({
          x: cx + ((k % 2) - 0.5) * 0.06,
          y: dy,
          z: cz + (((k + 1) % 2) - 0.5) * 0.06,
          sx: size,
          sy: k % 2 === 0 ? 0.74 : 0.44,
          sz: size,
        });
      }
    }
  }

  // 3. Expanded 3-Tier Stepped Acropolis Terraces & Retaining Stone Walls
  const rectPad = (cx: number, cz: number, layers: number, halfX: number, halfZ: number) => {
    const step = 0.48;
    for (let layer = 0; layer < layers; layer++) {
      const y = 0.26 + layer * 0.46;
      for (let x = cx - halfX; x <= cx + halfX + 0.001; x += step) {
        for (let z = cz - halfZ; z <= cz + halfZ + 0.001; z += step) {
          const isRim =
            Math.abs(x - (cx - halfX)) < step ||
            Math.abs(x - (cx + halfX)) < step ||
            Math.abs(z - (cz - halfZ)) < step ||
            Math.abs(z - (cz + halfZ)) < step;
          if (isRim || layer === layers - 1) {
            pushStone(x, y, z, 1.04, 1.02, 1.04);
          }
        }
      }
      for (let x = cx - halfX; x <= cx + halfX; x += 1.4) {
        mossSpecs.push({ x, y: y + 0.18, z: cz + halfZ + 0.18, sx: 0.65, sy: 0.45, sz: 0.55 });
      }
    }
  };
  // Tier 1 (Foreground Low Terraces): garden & timber cottages (spread wide to open the central plaza)
  rectPad(-6.2, 5.8, 1, 2.8, 2.3);
  rectPad(6.8, 5.4, 1, 2.6, 2.0);
  // Tier 2 (Mid-Flank Terraces): lantern, stone, violet & hearth cottages
  rectPad(-11.2, -0.2, 2, 2.1, 2.8);
  rectPad(11.0, -0.2, 1, 2.2, 2.8);
  rectPad(-3.6, -10.6, 2, 3.2, 2.2);
  rectPad(5.8, -10.2, 1, 2.8, 2.3);
  // Tier 3 (Grand Central Acropolis Plateau): towering Clockwork Cathedral Workshop
  rectPad(0.15, -1.25, 3, 4.0, 3.0);

  // Grand Stepped Cobblestone Staircase climbing up to the Central Workshop Acropolis
  for (let s = 0; s < 5; s++) {
    const sz = 3.2 - s * 0.42;
    const sy = 0.16 + s * 0.28;
    for (let sx = -1.8; sx <= 1.8; sx += 0.46) {
      pushStone(sx, sy, sz, 1.05, 0.68, 0.95);
    }
    stoneDarkSpecs.push(
      { x: -2.15, y: sy + 0.24, z: sz, sx: 0.58, sy: 0.85, sz: 0.78 },
      { x: 2.15, y: sy + 0.24, z: sz, sx: 0.58, sy: 0.85, sz: 0.78 },
    );
  }

  // 4. Expanded Lush Multi-Tiered Voxel Forest (18 Deep-Green Oak/Pine & Purple Jacaranda Trees)
  const addLushTree = (cx: number, baseY: number, cz: number, scale = 1.0, isPurple = false) => {
    trunkSpecs.push(
      { x: cx, y: baseY + 0.85 * scale, z: cz, sx: 0.65 * scale, sy: 3.6 * scale, sz: 0.65 * scale },
      { x: cx - 0.18 * scale, y: baseY + 0.22, z: cz + 0.14 * scale, sx: 0.45 * scale, sy: 0.9 * scale, sz: 0.45 * scale },
      { x: cx + 0.18 * scale, y: baseY + 0.22, z: cz - 0.14 * scale, sx: 0.45 * scale, sy: 0.9 * scale, sz: 0.45 * scale },
    );
    const puffs: ReadonlyArray<readonly [number, number, number, number, number]> = [
      [0, 1.85, 0, 2.6, 1.8],
      [-0.75, 1.55, 0.45, 1.9, 1.45],
      [0.75, 1.55, -0.45, 1.9, 1.45],
      [-0.55, 1.6, -0.65, 1.85, 1.4],
      [0.6, 1.6, 0.65, 1.85, 1.4],
      [-0.4, 2.35, 0.25, 1.8, 1.35],
      [0.45, 2.3, -0.25, 1.75, 1.35],
      [0, 2.75, 0, 1.45, 1.2],
    ];
    puffs.forEach(([dx, dy, dz, rXZ, rY], idx) => {
      const spec: VoxelSpec = {
        x: cx + dx * scale,
        y: baseY + dy * scale,
        z: cz + dz * scale,
        sx: rXZ * scale,
        sy: rY * scale,
        sz: rXZ * scale,
      };
      if (isPurple) {
        if (idx % 3 === 0) d.blossomPinkSpecs.push(spec);
        else if (idx % 3 === 1) d.blossomGoldSpecs.push(spec);
        else roofDarkSpecs.push(spec);
      } else {
        if (idx % 3 === 0) mossSpecs.push(spec);
        else if (idx % 2 === 0) grassSpecs.push(spec);
        else pineSpecs.push(spec);
      }
    });
  };

  // Outer Forest Belt + Acropolis Flanking Groves
  addLushTree(-14.6, 0.12, 5.2, 1.35, false);
  addLushTree(-12.6, 0.12, 9.6, 1.22, false);
  addLushTree(-10.2, 0.12, 11.8, 1.15, false);
  addLushTree(-14.8, 0.2, -3.8, 1.32, false);
  addLushTree(-12.4, 0.3, -8.8, 1.25, true);
  addLushTree(-6.8, 0.6, -5.2, 1.38, false);
  addLushTree(-9.6, 0.4, -4.8, 1.18, true);
  addLushTree(6.8, 0.6, -5.2, 1.35, false);
  addLushTree(11.4, 0.3, -7.8, 1.22, true);
  addLushTree(14.4, 0.15, -3.6, 1.3, false);
  addLushTree(14.2, 0.15, 4.2, 1.28, false);
  addLushTree(12.2, 0.12, 8.8, 1.2, false);
  addLushTree(13.8, 0.12, 6.6, 1.18, false);
  addLushTree(-3.4, 0.2, 3.2, 1.0, true);
  addLushTree(-8.4, 0.2, 3.4, 1.08, false);
  addLushTree(4.2, 0.2, 2.8, 0.98, true);
  // Mini trees on the floating islets
  addLushTree(-18.4, -1.8, 5.2, 0.72, false);
  addLushTree(18.2, -2.4, 4.4, 0.68, true);

  // Rounded moss & lavender bushes across the expanded terraces
  const addBush = (cx: number, cz: number, s = 1, withFlowers = true) => {
    mossSpecs.push(
      { x: cx, y: 0.28 * s, z: cz, sx: 0.72 * s, sy: 0.52 * s, sz: 0.68 * s },
      { x: cx - 0.24 * s, y: 0.24 * s, z: cz + 0.14 * s, sx: 0.52 * s, sy: 0.42 * s, sz: 0.48 * s },
      { x: cx + 0.22 * s, y: 0.3 * s, z: cz - 0.1 * s, sx: 0.48 * s, sy: 0.44 * s, sz: 0.46 * s },
    );
    if (withFlowers) {
      d.blossomPinkSpecs.push({ x: cx - 0.1 * s, y: 0.46 * s, z: cz + 0.12 * s, sx: 0.28, sy: 0.26, sz: 0.28 });
      d.blossomGoldSpecs.push({ x: cx + 0.16 * s, y: 0.44 * s, z: cz - 0.08 * s, sx: 0.24, sy: 0.22, sz: 0.24 });
    }
  };
  for (const [sx, sz, sc] of [
    [-11.8, 6.8, 1.15],
    [-10.4, 8.6, 1.1],
    [-4.8, 8.8, 1.0],
    [2.4, 8.6, 1.05],
    [11.4, 6.6, 1.15],
    [10.6, 8.4, 1.05],
    [-6.6, 3.2, 1.1],
    [6.6, 3.0, 1.1],
    [-10.2, -8.8, 1.1],
    [10.4, -8.2, 1.1],
    [-13.4, 1.2, 1.15],
    [13.6, 1.4, 1.15],
  ] as const) {
    addBush(sx, sz, sc, true);
  }

  // 5. Rustic Wooden Perimeter Fences along the Expanded Cliff Edges & Courtyard Lanes
  const addFenceRun = (x0: number, z0: number, x1: number, z1: number, posts: number, baseY = 0.08) => {
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const fx = x0 + (x1 - x0) * t;
      const fz = z0 + (z1 - z0) * t;
      timberSpecs.push({ x: fx, y: baseY + 0.32, z: fz, sx: 0.28, sy: 1.15, sz: 0.28 });
      if (i < posts) {
        const nx = x0 + (x1 - x0) * ((i + 0.5) / posts);
        const nz = z0 + (z1 - z0) * ((i + 0.5) / posts);
        const segLen = Math.hypot(x1 - x0, z1 - z0) / posts;
        const isX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
        scaffSpecs.push(
          {
            x: nx,
            y: baseY + 0.44,
            z: nz,
            sx: isX ? segLen * 2.05 : 0.18,
            sy: 0.18,
            sz: isX ? 0.18 : segLen * 2.05,
          },
          {
            x: nx,
            y: baseY + 0.22,
            z: nz,
            sx: isX ? segLen * 2.05 : 0.18,
            sy: 0.18,
            sz: isX ? 0.18 : segLen * 2.05,
          },
        );
      }
    }
  };
  addFenceRun(-13.2, 9.2, -9.8, 12.2, 4, 0.08);
  addFenceRun(-6.6, 13.4, -3.8, 14.4, 3, 0.08);
  addFenceRun(0.8, 14.4, 4.4, 13.4, 3, 0.08);
  addFenceRun(8.4, 12.2, 12.2, 9.2, 4, 0.08);
  addFenceRun(13.2, 7.2, 15.2, 3.2, 4, 0.08);
  addFenceRun(-15.2, 3.6, -15.2, -2.4, 5, 0.08);

  // 6. 20 Warm Stone & Timber Street Lanterns lining the Expanded Cobblestone Paths
  for (const [lx, ly, lz] of [
    [-6.2, 0.12, 9.6],
    [-3.4, 0.12, 10.8],
    [0.4, 0.12, 11.6],
    [2.8, 0.12, 10.6],
    [6.2, 0.12, 9.2],
    [9.8, 0.12, 6.2],
    [-2.0, 0.22, 7.4],
    [1.8, 0.22, 7.2],
    [-2.0, 0.28, 4.6],
    [1.8, 0.28, 4.6],
    [-5.4, 0.25, 2.6],
    [6.2, 0.25, 2.6],
    [8.2, 0.25, -1.8],
    [-7.8, 0.25, -1.8],
    [-2.8, 0.45, -6.4],
    [2.8, 0.45, -6.4],
    [-11.2, 0.18, 6.2],
    [11.4, 0.18, 5.8],
  ] as const) {
    stoneDarkSpecs.push({ x: lx, y: ly + 0.16, z: lz, sx: 0.42, sy: 0.55, sz: 0.42 });
    timberSpecs.push({ x: lx, y: ly + 0.56, z: lz, sx: 0.24, sy: 1.35, sz: 0.24 });
    lanternSpecs.push({ x: lx, y: ly + 0.96, z: lz, sx: 0.46, sy: 0.58, sz: 0.46 });
    stoneDarkSpecs.push({ x: lx, y: ly + 1.18, z: lz, sx: 0.56, sy: 0.18, sz: 0.56 });
  }

  // Wishing well on the north-west plaza
  stoneMidSpecs.push({ x: -7.8, y: 0.42, z: -11.6, sx: 1.45, sy: 0.84, sz: 1.45 });
  stoneDarkSpecs.push({ x: -7.8, y: 0.72, z: -11.6, sx: 0.72, sy: 0.28, sz: 0.72 });
  timberSpecs.push(
    { x: -8.15, y: 1.05, z: -11.6, sx: 0.14, sy: 1.15, sz: 0.14 },
    { x: -7.45, y: 1.05, z: -11.6, sx: 0.14, sy: 1.15, sz: 0.14 },
  );
  roofDarkSpecs.push({ x: -7.8, y: 1.55, z: -11.6, sx: 1.7, sy: 0.22, sz: 1.35 });

  // 7. Five Foreground Service Stations (Spread comfortably across the Expanded Front Terrace)
  // 7.1 Twitch !idea Post Pavilion (x: -8.0, z: 10.25)
  stoneDarkSpecs.push({ x: -8.0, y: 0.14, z: 10.25, sx: 3.4, sy: 0.45, sz: 2.6 });
  stoneMidSpecs.push({ x: -8.0, y: 0.32, z: 10.25, sx: 2.8, sy: 0.45, sz: 2.1 });
  timberSpecs.push(
    { x: -8.5, y: 1.1, z: 10.15, sx: 0.42, sy: 3.1, sz: 0.42 },
    { x: -7.5, y: 1.1, z: 10.15, sx: 0.42, sy: 3.1, sz: 0.42 },
    { x: -8.0, y: 0.85, z: 10.25, sx: 0.58, sy: 1.8, sz: 0.58 },
  );
  scaffSpecs.push({ x: -8.0, y: 1.38, z: 10.4, sx: 2.1, sy: 1.4, sz: 0.95 });
  roofDarkSpecs.push(
    { x: -8.0, y: 1.92, z: 10.28, sx: 3.2, sy: 0.48, sz: 2.2 },
    { x: -8.0, y: 2.18, z: 10.28, sx: 2.2, sy: 0.45, sz: 1.6 },
    { x: -8.0, y: 2.4, z: 10.28, sx: 1.3, sy: 0.42, sz: 1.0 },
  );
  lanternSpecs.push({ x: -8.0, y: 1.75, z: 10.68, sx: 0.52, sy: 0.55, sz: 0.42 });

  // 7.2 Live Ballot Obelisk Shrine (x: -2.1, z: 12.35)
  stoneDarkSpecs.push({ x: -2.1, y: 0.14, z: 12.35, sx: 7.4, sy: 0.45, sz: 2.4 });
  stoneMidSpecs.push(
    { x: -2.1, y: 0.34, z: 12.35, sx: 6.6, sy: 0.48, sz: 1.9 },
    { x: -3.45, y: 0.68, z: 12.25, sx: 1.05, sy: 1.25, sz: 1.05 },
    { x: -0.75, y: 0.68, z: 12.25, sx: 1.05, sy: 1.25, sz: 1.05 },
  );
  timberSpecs.push(
    { x: -3.45, y: 1.48, z: 12.25, sx: 0.52, sy: 3.8, sz: 0.52 },
    { x: -0.75, y: 1.48, z: 12.25, sx: 0.52, sy: 3.8, sz: 0.52 },
  );
  scaffSpecs.push(
    { x: -2.1, y: 0.58, z: 12.36, sx: 6.2, sy: 0.4, sz: 0.95 },
    { x: -2.1, y: 2.35, z: 12.28, sx: 6.6, sy: 0.42, sz: 0.95 },
  );
  roofDarkSpecs.push(
    { x: -2.1, y: 1.48, z: 12.22, sx: 5.8, sy: 3.5, sz: 0.38 },
    { x: -2.1, y: 2.58, z: 12.28, sx: 6.8, sy: 0.5, sz: 1.45 },
    { x: -2.1, y: 2.84, z: 12.28, sx: 4.8, sy: 0.48, sz: 1.2 },
    { x: -2.1, y: 3.08, z: 12.28, sx: 2.8, sy: 0.45, sz: 0.95 },
  );
  lanternSpecs.push(
    { x: -3.45, y: 2.05, z: 12.5, sx: 0.5, sy: 0.62, sz: 0.45 },
    { x: -0.75, y: 2.05, z: 12.5, sx: 0.5, sy: 0.62, sz: 0.45 },
  );

  // 7.3 Aria Planner Blueprint Gazebo (x: 4.45, z: 10.15)
  stoneDarkSpecs.push({ x: 4.45, y: 0.14, z: 10.15, sx: 5.2, sy: 0.42, sz: 4.0 });
  timberSpecs.push(
    { x: 3.55, y: 1.15, z: 9.5, sx: 0.42, sy: 3.3, sz: 0.42 },
    { x: 5.35, y: 1.15, z: 9.5, sx: 0.42, sy: 3.3, sz: 0.42 },
    { x: 3.55, y: 1.15, z: 10.8, sx: 0.42, sy: 3.3, sz: 0.42 },
    { x: 5.35, y: 1.15, z: 10.8, sx: 0.42, sy: 3.3, sz: 0.42 },
    { x: 3.85, y: 0.5, z: 9.85, sx: 0.35, sy: 1.5, sz: 0.35 },
    { x: 5.05, y: 0.5, z: 9.85, sx: 0.35, sy: 1.5, sz: 0.35 },
    { x: 3.85, y: 0.5, z: 10.5, sx: 0.35, sy: 1.5, sz: 0.35 },
    { x: 5.05, y: 0.5, z: 10.5, sx: 0.35, sy: 1.5, sz: 0.35 },
  );
  scaffSpecs.push(
    { x: 4.45, y: 0.88, z: 10.18, sx: 3.4, sy: 0.34, sz: 2.2 },
    { x: 4.45, y: 1.82, z: 10.15, sx: 4.4, sy: 0.34, sz: 3.1 },
  );
  roofDarkSpecs.push(
    { x: 4.45, y: 2.02, z: 10.15, sx: 4.8, sy: 0.48, sz: 3.6 },
    { x: 4.45, y: 2.26, z: 10.15, sx: 3.4, sy: 0.45, sz: 2.5 },
    { x: 4.45, y: 2.48, z: 10.15, sx: 2.0, sy: 0.42, sz: 1.45 },
  );
  lanternSpecs.push({ x: 5.05, y: 1.08, z: 10.45, sx: 0.45, sy: 0.52, sz: 0.45 });

  // 7.4 MCP Relay Beacon Pedestal (x: 2.7, z: 3.6)
  stoneDarkSpecs.push({ x: 2.7, y: 0.14, z: 3.6, sx: 2.8, sy: 0.42, sz: 2.8 });
  stoneMidSpecs.push(
    { x: 2.7, y: 0.34, z: 3.6, sx: 2.1, sy: 0.52, sz: 2.1 },
    { x: 2.7, y: 0.64, z: 3.6, sx: 1.4, sy: 0.8, sz: 1.4 },
  );
  timberSpecs.push(
    { x: 2.38, y: 0.94, z: 3.28, sx: 0.32, sy: 2.0, sz: 0.32 },
    { x: 3.02, y: 0.94, z: 3.28, sx: 0.32, sy: 2.0, sz: 0.32 },
    { x: 2.38, y: 0.94, z: 3.92, sx: 0.32, sy: 2.0, sz: 0.32 },
    { x: 3.02, y: 0.94, z: 3.92, sx: 0.32, sy: 2.0, sz: 0.32 },
  );
  roofDarkSpecs.push({ x: 2.7, y: 1.42, z: 3.6, sx: 1.9, sy: 0.36, sz: 1.9 });

  // 7.5 Build Outpost Forge Stall (x: 8.7, z: 9.3)
  stoneDarkSpecs.push({ x: 8.7, y: 0.14, z: 9.3, sx: 4.6, sy: 0.4, sz: 3.4 });
  stoneMidSpecs.push({ x: 7.9, y: 0.34, z: 9.85, sx: 2.2, sy: 0.65, sz: 1.05 });
  timberSpecs.push(
    { x: 8.0, y: 1.12, z: 8.78, sx: 0.42, sy: 3.5, sz: 0.42 },
    { x: 9.4, y: 1.12, z: 8.78, sx: 0.42, sy: 3.5, sz: 0.42 },
    { x: 8.0, y: 0.88, z: 9.82, sx: 0.42, sy: 2.6, sz: 0.42 },
    { x: 9.4, y: 0.88, z: 9.82, sx: 0.42, sy: 2.6, sz: 0.42 },
  );
  roofDarkSpecs.push(
    { x: 8.7, y: 2.08, z: 8.85, sx: 4.2, sy: 0.45, sz: 1.35 },
    { x: 8.7, y: 1.82, z: 9.32, sx: 4.4, sy: 0.45, sz: 1.35 },
    { x: 8.7, y: 1.54, z: 9.8, sx: 4.6, sy: 0.45, sz: 1.45 },
  );
  scaffSpecs.push(
    { x: 8.35, y: 0.42, z: 9.1, sx: 1.45, sy: 1.1, sz: 1.45 },
    { x: 9.0, y: 0.48, z: 8.9, sx: 1.15, sy: 0.9, sz: 1.15 },
  );

  // 8. Winding Multi-Stone Cobblestone Paths & Hanging Cliff Vines
  for (const [x, z] of routeStones(0.72)) {
    const h = hash2(x * 3.1, z * 3.1);
    stoneMidSpecs.push({ x, y: 0.11, z, sx: 1.22, sy: 0.22, sz: 1.08 });
    stoneLightSpecs.push({ x: x + (h - 0.5) * 0.44, y: 0.13, z: z + 0.28, sx: 0.82, sy: 0.24, sz: 0.76 });
    stoneDarkSpecs.push({ x: x - (h - 0.5) * 0.4, y: 0.1, z: z - 0.26, sx: 0.76, sy: 0.2, sz: 0.72 });
  }

  for (const [x, z] of [
    [-5.8, 13.8],
    [-2.2, 14.6],
    [1.6, 14.4],
    [5.6, 13.4],
    [9.8, 11.4],
    [-12.8, 8.4],
    [12.8, 7.8],
  ] as const) {
    mossSpecs.push(
      { x, y: -0.45, z, sx: 0.36, sy: 1.9, sz: 0.36 },
      { x: x + 0.22, y: -1.18, z: z + 0.08, sx: 0.28, sy: 1.45, sz: 0.28 },
    );
    d.blossomPinkSpecs.push({ x, y: -0.85, z, sx: 0.26, sy: 0.26, sz: 0.26 });
  }
}

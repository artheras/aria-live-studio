import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../public/models");

function makeMaterials(colors = {}) {
  const std = (color, roughness, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: extra.metalness ?? 0, ...extra });
  return {
    plaster: std(colors.plaster ?? 0xc4ae92, colors.plasterRoughness ?? 0.82),
    creamFrame: std(colors.creamFrame ?? 0xb8a288, 0.72),
    stone: std(colors.stone ?? 0x625d6e, 0.9),
    stoneLight: std(colors.stoneLight ?? 0x7c768a, 0.86),
    stoneDark: std(colors.stoneDark ?? 0x454152, 0.94),
    terrace: std(colors.terrace ?? 0x686274, 0.88),
    terraceDark: std(colors.terraceDark ?? 0x4c4758, 0.92),
    slate: std(colors.slate ?? 0x3b3748, 0.88),
    beam: std(colors.beam ?? 0x5e3b1f, colors.beamRoughness ?? 0.84),
    beamDark: std(colors.beamDark ?? 0x3d2411, 0.9),
    roof: std(colors.roof ?? 0x5c34a8, colors.roofRoughness ?? 0.46, { metalness: colors.roofMetalness ?? 0.08 }),
    roofLight: std(colors.roofLight ?? 0x784fd0, Math.max(0.32, (colors.roofRoughness ?? 0.46) - 0.05), {
      metalness: Math.max(0, (colors.roofMetalness ?? 0.08) - 0.02),
    }),
    roofDeep: std(colors.roofDeep ?? 0x3f2278, 0.52, { metalness: 0.06 }),
    door: std(colors.door ?? 0x5a3620, 0.62),
    glass: std(colors.glass ?? 0xffd88a, 0.2, {
      emissive: colors.glassEmissive ?? 0xff8c1a,
      emissiveIntensity: colors.glassIntensity ?? 2.35,
    }),
    sunGlass: std(colors.sunGlass ?? 0xffd480, 0.22, {
      transparent: true,
      opacity: 0.88,
      emissive: 0xff9424,
      emissiveIntensity: 1.45,
    }),
    fire: std(0xffcf48, 0.18, { emissive: 0xff5510, emissiveIntensity: 2.8 }),
    shutter: std(colors.shutter ?? 0x683ec2, 0.52),
    leaf: std(0x2f5e32, 0.78),
    leafDark: std(0x1f4422, 0.84),
    pink: std(0xb865f0, 0.5),
    purpleFlower: std(0x9346e8, 0.48),
    white: std(0xd8b4fe, 0.48),
    gold: std(colors.gold ?? 0x8a62d8, 0.42, { metalness: 0.18 }),
    lantern: std(0xffe49e, 0.2, { emissive: 0xff9818, emissiveIntensity: colors.lanternIntensity ?? 2.4 }),
    log: std(colors.log ?? 0x784b26, 0.84),
    logEnd: std(0xba8c58, 0.76),
    smoke: std(0x9b8bb8, 0.95, { transparent: true, opacity: 0.55 }),
  };
}

function createBuilder(S) {
  const buckets = new Map();
  const block = (name, ix, iy, iz, sx = 1, sy = 1, sz = 1) => {
    const geo = new THREE.BoxGeometry(sx * S * 0.96, sy * S * 0.96, sz * S * 0.96);
    geo.translate((ix + sx / 2) * S, (iy + sy / 2) * S, (iz + sz / 2) * S);
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = [];
      buckets.set(name, bucket);
    }
    bucket.push(geo);
  };
  const group = (materials) => {
    const root = new THREE.Group();
    for (const [name, geos] of buckets) {
      if (!materials[name] || geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, materials[name]);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    return root;
  };
  return { block, group };
}

/** Fill a stone brick terrace platform with subtle alternating brick texture. */
function addTerrace(block, x0, x1, z0, z1, h = 2, matA = "terrace", matB = "terraceDark") {
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === h - 1;
        if (!edge) continue;
        block((x + y + z) % 2 === 0 ? matA : matB, x, y, z);
      }
    }
  }
}

/** Build 4-wall shell with stone wainscoting, corner timber columns & top belt beam. */
function addTimberWalls(block, x0, x1, z0, z1, y0, y1, stoneH = 2) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        if (!edge) continue;
        const isCorner = (x <= x0 + 1 || x >= x1 - 1) && (z <= z0 + 1 || z >= z1 - 1);
        let mat = "plaster";
        if (y < y0 + stoneH) mat = (x + y + z) % 2 === 0 ? "stone" : "stoneDark";
        else if (isCorner || y === y1) mat = "beam";
        block(mat, x, y, z);
      }
    }
  }
}

/**
 * Fine-stepped front-facing gable roof (ridge along Z, slopes along X).
 * Renders crisp individual voxel stair-steps with gold or purple gable trim.
 */
function addSteppedFrontGable(block, x0, x1, z0, z1, baseY, slope = 0.85, trimMat = "gold", fillGable = true) {
  const mid = (x0 + x1) / 2;
  const halfSpan = (x1 - x0) / 2;
  for (let x = x0; x <= x1; x++) {
    const dist = Math.abs(x - mid);
    const rise = Math.round((halfSpan - dist) * slope);
    const roofY = baseY + rise;
    if (fillGable && x > x0 + 1 && x < x1 - 1) {
      for (let gy = baseY; gy < roofY; gy++) {
        block("plaster", x, gy, z1 - 1);
        block("plaster", x, gy, z0 + 1);
      }
    }
    for (let z = z0; z <= z1; z++) {
      const isGableEdge = z === z1 || z === z0;
      const mat = isGableEdge ? trimMat : (x + z) % 2 === 0 ? "roof" : "roofLight";
      block(mat, x, roofY, z, 1, 1.15, 1);
      if (!isGableEdge && rise > 0) {
        block("roofDeep", x, roofY - 0.6, z, 1, 0.65, 1);
      }
    }
  }
  // Peak ridge cap along Z
  const peakY = baseY + Math.round(halfSpan * slope) + 1;
  for (let z = z0; z <= z1; z++) {
    const isEnd = z === z1 || z === z0;
    block(isEnd ? trimMat : "roofLight", Math.round(mid) - 0.5, peakY - 0.4, z, 1.4, 1.1, 1);
  }
}

/** Mullioned glowing window proud of the front wall (+Z), with shutters & flower box. */
function addFrontWindow(block, cx, cy, zWall, hasShutters = true, hasBox = true) {
  const z = zWall + 0.92;
  // Dark wood frame + 2x2 glowing panes + cross muntins
  block("beamDark", cx - 1.6, cy - 0.2, z - 0.1, 3.2, 3.4, 0.45);
  block("glass", cx - 1.2, cy + 0.1, z + 0.15, 2.4, 2.8, 0.32);
  block("beamDark", cx - 0.12, cy + 0.1, z + 0.32, 0.24, 2.8, 0.25);
  block("beamDark", cx - 1.2, cy + 1.38, z + 0.32, 2.4, 0.24, 0.25);
  if (hasShutters) {
    block("shutter", cx - 2.55, cy, z + 0.12, 0.95, 3.0, 0.42);
    block("shutter", cx + 1.6, cy, z + 0.12, 0.95, 3.0, 0.42);
    block("shutter", cx - 1.8, cy + 3.1, z + 0.15, 3.6, 0.65, 0.48);
  }
  if (hasBox) {
    block("beam", cx - 1.8, cy - 0.95, z + 0.18, 3.6, 0.78, 0.95);
    block("leaf", cx - 1.6, cy - 0.22, z + 0.26, 3.2, 0.55, 0.8);
    block("purpleFlower", cx - 1.3, cy + 0.2, z + 0.36, 0.65, 0.5, 0.55);
    block("pink", cx - 0.2, cy + 0.25, z + 0.4, 0.65, 0.52, 0.55);
    block("white", cx + 0.8, cy + 0.18, z + 0.36, 0.6, 0.48, 0.55);
  }
}

/** Front door proud of the front wall (+Z) with timber jambs, gold knob & stepped purple arch awning. */
function addFrontDoor(block, cx, y0, zWall, doorMat = "door", hasPurpleAwning = true) {
  const z = zWall + 0.88;
  block("beam", cx - 2.1, y0, z - 0.1, 0.8, 5.2, 0.75);
  block("beam", cx + 1.3, y0, z - 0.1, 0.8, 5.2, 0.75);
  block("beam", cx - 2.1, y0 + 5.0, z - 0.1, 4.2, 0.75, 0.8);
  block(doorMat, cx - 1.3, y0, z, 2.6, 5.0, 0.42);
  // Subtle door panels & gold handle
  block("glass", cx - 0.9, y0 + 3.0, z + 0.18, 0.7, 1.2, 0.32);
  block("glass", cx + 0.2, y0 + 3.0, z + 0.18, 0.7, 1.2, 0.32);
  block("gold", cx - 1.05, y0 + 2.1, z + 0.35, 0.38, 0.38, 0.35);
  if (hasPurpleAwning) {
    block("shutter", cx - 2.7, y0 + 4.3, z + 0.28, 1.2, 0.85, 1.15);
    block("shutter", cx + 1.5, y0 + 4.3, z + 0.28, 1.2, 0.85, 1.15);
    block("shutter", cx - 2.1, y0 + 5.0, z + 0.32, 4.2, 0.85, 1.25);
    block("roofLight", cx - 1.3, y0 + 5.7, z + 0.36, 2.6, 0.65, 1.1);
  }
}

function addStackedLogs(block, x0, y0, z0, cols = 3) {
  for (let r = 0; r < cols; r++) {
    const count = cols - r;
    for (let i = 0; i < count; i++) {
      const lx = x0 + i * 0.95 + r * 0.48;
      const ly = y0 + r * 0.78;
      block("log", lx, ly, z0, 0.84, 0.76, 1.9);
      block("logEnd", lx + 0.1, ly + 0.1, z0 + 1.85, 0.64, 0.56, 0.12);
    }
  }
}

function addLampPost(block, x, y0, z, postH = 2.8) {
  block("stoneDark", x - 0.45, y0, z - 0.45, 0.9, 0.9, 0.9);
  if (postH > 1.2) {
    block("stoneDark", x - 0.25, y0 + 0.9, z - 0.25, 0.5, postH - 0.9, 0.5);
  }
  const ly = y0 + postH;
  block("stoneDark", x - 0.5, ly, z - 0.5, 1.0, 0.25, 1.0);
  block("lantern", x - 0.38, ly + 0.25, z - 0.38, 0.76, 1.05, 0.76);
  block("stoneDark", x - 0.55, ly + 1.3, z - 0.55, 1.1, 0.3, 1.1);
  block("stoneDark", x - 0.3, ly + 1.6, z - 0.3, 0.6, 0.3, 0.6);
}

function addFlowerPatch(block, x, y, z, color = "purpleFlower") {
  block("leaf", x, y, z, 0.95, 0.55, 0.95);
  block("leafDark", x + 0.2, y + 0.3, z + 0.15, 0.6, 0.45, 0.6);
  block(color, x + 0.15, y + 0.55, z + 0.2, 0.52, 0.48, 0.52);
  block(color === "purpleFlower" ? "pink" : "white", x + 0.55, y + 0.45, z + 0.45, 0.42, 0.42, 0.42);
}

function buildCottage(kind) {
  const palettes = {
    violet: {
      plaster: 0xc2ab90,
      terrace: 0x625d6e,
      terraceDark: 0x484354,
      stone: 0x605b6c,
      stoneDark: 0x433f4e,
      beam: 0x5c391e,
      roof: 0x5832a4,
      roofLight: 0x744bcb,
      shutter: 0x6a40bf,
      door: 0x58341c,
      gold: 0x865cd6,
    },
    timber: {
      plaster: 0xbea68b,
      terrace: 0x5e596a,
      terraceDark: 0x454050,
      stone: 0x5e596a,
      stoneDark: 0x433f4e,
      beam: 0x5a371c,
      beamDark: 0x3b2210,
      roof: 0x5630a0,
      roofLight: 0x7249c8,
      roofRoughness: 0.48,
      door: 0x54321a,
      gold: 0x7e54d0,
    },
    lantern: {
      plaster: 0xc0a98e,
      terrace: 0x605b6c,
      terraceDark: 0x464152,
      stone: 0x605b6c,
      stoneDark: 0x433f4e,
      beam: 0x5c391e,
      roof: 0x5832a4,
      roofLight: 0x744bcb,
      shutter: 0x6a40bf,
      door: 0x58341c,
      gold: 0x865cd6,
      glassIntensity: 2.4,
      lanternIntensity: 2.5,
    },
    garden: {
      plaster: 0xc2ab90,
      creamFrame: 0x6e4828,
      terrace: 0x605b6c,
      terraceDark: 0x464152,
      stone: 0x605b6c,
      stoneDark: 0x433f4e,
      beam: 0x5c391e,
      roof: 0x5a34a6,
      roofLight: 0x764ecc,
      shutter: 0x6c42c2,
      door: 0x58341c,
      gold: 0x865cd6,
    },
    stone: {
      plaster: 0xbaa388,
      terrace: 0x5e596a,
      terraceDark: 0x454050,
      stone: 0x625d6e,
      stoneLight: 0x787286,
      stoneDark: 0x454152,
      slate: 0x3b3748,
      roof: 0x5832a4,
      roofLight: 0x744bcb,
      door: 0x54321a,
      gold: 0x865cd6,
      glassIntensity: 2.35,
    },
    hearth: {
      plaster: 0xc0a88d,
      terrace: 0x605b6c,
      terraceDark: 0x464152,
      stone: 0x625d6e,
      stoneLight: 0x787286,
      stoneDark: 0x454152,
      beam: 0x5c391e,
      roof: 0x5a33a4,
      roofLight: 0x764ccc,
      door: 0x56331b,
      gold: 0x865cd6,
    },
  };

  const materials = makeMaterials(palettes[kind]);
  // Fine micro-voxel scale (S = 0.145) so houses have rich architectural detail within the same island footprint
  const { block, group } = createBuilder(0.145);

  if (kind === "violet") {
    // ── IMAGE 1: Purple & Gold Gable Cottage with Right Cross-Wing, Bay Window & Chimney ──
    addTerrace(block, -11, 10, -14, 2, 2);
    // Front 3-step stone stairs
    for (let s = 0; s < 3; s++) {
      block("terrace", -6, (2 - s) * 0.65, 2.2 + s * 0.95, 5.2, 0.7, 1.05);
    }

    // Main 2-story cottage body
    addTimberWalls(block, -9, 6, -12, 0, 2, 10, 2);
    // Horizontal mid-story timber belt + decorative corbel brackets
    block("beam", -9.2, 9.8, -12.2, 16.4, 0.85, 13.4);
    block("beam", -4.2, 9.1, 0.3, 1.0, 0.8, 0.8);
    block("beam", 0.2, 9.1, 0.3, 1.0, 0.8, 0.8);

    // Right projecting bay window wing + purple pent roof
    addTimberWalls(block, 6, 9, -9, -2, 2, 8, 2);
    for (let s = 0; s < 3; s++) {
      block(s % 2 === 0 ? "roof" : "roofLight", 6.2 + s * 1.1, 9.8 - s * 0.65, -9.4, 1.3, 0.8, 8.2);
    }
    // Right bay window + shutters + flower box (proud of x = 9..10 wall)
    block("glass", 9.95, 4.2, -6.8, 0.45, 2.8, 2.6);
    block("shutter", 10.0, 4.2, -7.8, 0.5, 2.9, 0.9);
    block("shutter", 10.0, 4.2, -4.1, 0.5, 2.9, 0.9);
    block("beam", 10.0, 3.3, -7.6, 0.9, 0.75, 4.2);
    block("leaf", 10.1, 4.0, -7.4, 0.75, 0.5, 3.8);
    block("purpleFlower", 10.2, 4.4, -6.8, 0.55, 0.45, 0.8);
    block("pink", 10.2, 4.4, -5.2, 0.55, 0.45, 0.8);

    // Steep purple roof with bright GOLD stepped gable trim + right cross-gable
    addSteppedFrontGable(block, -10, 7, -13, 1, 10, 0.9, "gold", true);
    for (let z = -10; z <= -2; z++) {
      const dz = Math.abs(z + 6);
      const ry = 11.2 + Math.round((4 - dz) * 0.85);
      for (let x = 4; x <= 9; x++) {
        block(x === 9 ? "gold" : (x + z) % 2 === 0 ? "roof" : "roofLight", x, ry, z, 1, 1.1, 1);
      }
    }

    // Front purple door + arched purple awning + 1st & 2nd floor shuttered windows
    addFrontDoor(block, -3.5, 2, 0, "door", true);
    addFrontWindow(block, 2.5, 4.2, 0, true, true);
    addFrontWindow(block, -1.5, 11.6, 0, true, true);

    // Tall stone chimney on right roof slope + stepped purple cap + smoke puffs
    for (let y = 12; y <= 19; y++) {
      block(y % 2 === 0 ? "stone" : "stoneDark", 2.5, y, -8.5, 2.8, 1.0, 2.8);
    }
    block("roof", 2.0, 20.0, -9.0, 3.8, 0.75, 3.8);
    block("roofLight", 2.4, 20.75, -8.6, 3.0, 0.7, 3.0);
    block("smoke", 3.1, 21.8, -7.9, 1.2, 0.9, 1.2);
    block("smoke", 3.6, 23.0, -7.4, 1.6, 1.1, 1.6);
    block("smoke", 4.3, 24.4, -6.8, 2.0, 1.2, 2.0);

    // Stacked firewood logs + planter box + 2 left warm lamp posts + flowers
    addStackedLogs(block, -0.5, 2.0, 0.3, 3);
    block("beam", -1.8, 2.0, 0.4, 1.2, 1.2, 1.2);
    addLampPost(block, -9.8, 2.0, 1.2, 1.1);
    addLampPost(block, -8.6, 2.0, -0.2, 3.4);
    for (const [fx, fz, col] of [
      [-10.2, -0.4, "purpleFlower"],
      [-8.0, 0.8, "pink"],
      [0.5, 1.1, "purpleFlower"],
      [3.2, 1.0, "white"],
      [5.5, 0.9, "purpleFlower"],
      [7.8, -1.2, "pink"],
    ]) {
      addFlowerPatch(block, fx, 2.0, fz, col);
    }
  } else if (kind === "timber") {
    // ── IMAGE 2: Wide Tudor Half-Timber Cottage with Purple-Gold Striped Roof & Front Porch ──
    addTerrace(block, -11, 11, -11, 2, 2, "stone", "stoneDark");
    addTimberWalls(block, -10, 9, -10, 0, 2, 9, 2);

    // Tudor vertical & diagonal timber framing on front & right gable walls
    for (const vx of [-10, -5, -2, 2, 5, 9]) {
      block("beam", vx, 4, 0.25, 0.85, 5.5, 0.45);
    }
    for (let i = 0; i < 4; i++) {
      block("beam", -9.2 + i * 0.9, 4.2 + i * 0.9, 0.22, 0.85, 0.9, 0.4);
      block("beam", 5.8 + i * 0.8, 4.2 + i * 0.9, 0.22, 0.85, 0.9, 0.4);
      block("beam", 9.25, 4.2 + i * 0.9, -9.2 + i * 0.9, 0.4, 0.9, 0.85);
      block("beam", 9.25, 4.2 + i * 0.9, -1.8 - i * 0.9, 0.4, 0.9, 0.85);
    }

    // Side-gabled pitched roof with diagonal PURPLE & GOLD stripes + thick brown timber bargeboards
    const midZ = -5.0;
    for (let z = -11; z <= 1; z++) {
      const dz = Math.abs(z - midZ);
      const ry = 9.2 + Math.round((6.0 - dz) * 0.9);
      for (let gy = 9; gy < ry; gy++) {
        const isPost = Math.abs(z - midZ) < 0.8;
        block(isPost ? "beam" : "plaster", -10, gy, z);
        block(isPost ? "beam" : "plaster", 9, gy, z);
      }
      for (let x = -11; x <= 10; x++) {
        const isBarge = x === -11 || x === 10;
        const stripe = Math.floor((x + z + 30) / 2) % 2 === 0 ? "roof" : "gold";
        block(isBarge ? "beam" : stripe, x, ry, z, 1, 1.1, 1);
      }
    }
    // Continuous wooden ridge beam + left & right gable finial posts
    block("beam", -11.2, 14.8, -5.6, 22.4, 1.1, 1.4);
    block("beam", -11.4, 14.2, -5.8, 1.6, 2.4, 1.8);
    block("beam", 9.8, 14.2, -5.8, 1.6, 2.4, 1.8);

    // Protruding Front Porch Canopy (purple-and-gold striped) + 2 wooden pillars on stone plinths + hanging lantern
    for (let z = 0; z <= 4; z++) {
      const py = 8.4 - z * 0.55;
      for (let x = -4; x <= 3; x++) {
        const stripe = Math.floor((x + z + 20) / 2) % 2 === 0 ? "roof" : "gold";
        block(stripe, x, py, z + 0.5, 1, 0.9, 1);
      }
    }
    block("beam", -4.2, 5.8, 0.4, 8.4, 0.65, 4.4);
    for (const px of [-3.8, 2.8]) {
      block("stone", px - 0.2, 2.0, 3.6, 1.4, 1.6, 1.4);
      block("beam", px, 3.6, 3.8, 1.0, 3.2, 1.0);
    }
    block("lantern", -3.9, 4.6, 4.7, 0.85, 1.15, 0.85);

    // Front stone steps + wooden door + left/right warm windows + right stacked firewood logs
    block("stone", -2.8, 1.2, 1.8, 5.2, 0.8, 2.6);
    block("stoneLight", -2.4, 0.5, 3.8, 4.4, 0.7, 1.4);
    addFrontDoor(block, -0.2, 2, 0, "door", false);
    addFrontWindow(block, -7.2, 4.2, 0, false, true);
    addFrontWindow(block, 6.2, 4.2, 0, false, true);
    // Side window on right gable wall
    block("glass", 9.3, 4.2, -6.2, 0.45, 2.6, 2.6);
    block("beam", 9.35, 3.4, -6.5, 0.85, 0.7, 3.2);
    block("leaf", 9.4, 4.0, -6.3, 0.7, 0.48, 2.8);
    addStackedLogs(block, 9.5, 2.0, -8.2, 3);

    for (const [fx, fz, col] of [
      [-10.4, 0.8, "pink"],
      [-8.2, 1.0, "purpleFlower"],
      [-5.6, 1.1, "white"],
      [4.5, 1.1, "white"],
      [7.0, 1.0, "purpleFlower"],
    ]) {
      addFlowerPatch(block, fx, 2.0, fz, col);
    }
  } else if (kind === "lantern") {
    // ── IMAGE 3: Left 3-Story Square Lantern Tower + Right Gold-Trimmed Purple Gable Wing ──
    addTerrace(block, -11, 8, -11, 2, 2, "stone", "stoneDark");
    for (let s = 0; s < 2; s++) {
      block("stoneLight", -1.2, (2 - s) * 0.65, 2.1 + s * 0.9, 4.8, 0.7, 1.0);
    }

    // Left 3-Story Square Tower (x: -10..-4, z: -9..-3, y: 2..19)
    for (let y = 2; y <= 18; y++) {
      for (let x = -10; x <= -4; x++) {
        for (let z = -9; z <= -3; z++) {
          const edge = x === -10 || x === -4 || z === -9 || z === -3;
          if (!edge) continue;
          const isCorner = (x === -10 || x === -4) && (z === -9 || z === -3);
          const isCornice = y === 7 || y === 13 || y === 18;
          const isWinY = (y >= 4 && y <= 6) || (y >= 9 && y <= 11) || (y >= 14 && y <= 17);
          const isWinXZ = (x >= -8 && x <= -6) || (z >= -7 && z <= -5);
          if (isCornice) {
            block("beam", x - 0.15, y, z - 0.15, 1.3, 0.75, 1.3);
          } else if (isCorner) {
            block("beam", x, y, z);
          } else if (isWinY && isWinXZ) {
            block(y >= 14 ? "lantern" : "glass", x, y, z);
          } else {
            block(y <= 3 ? "stone" : "plaster", x, y, z);
          }
        }
      }
    }
    // Window crossbars on tower faces
    for (const wy of [5.0, 10.0, 15.5]) {
      block("beamDark", -7.1, wy - 1.2, -2.7, 0.25, 2.6, 0.3);
      block("beamDark", -8.3, wy, -2.7, 2.6, 0.25, 0.3);
      block("beamDark", -10.3, wy - 1.2, -6.1, 0.3, 2.6, 0.25);
      block("beamDark", -10.3, wy, -7.3, 0.3, 0.25, 2.6);
    }
    // Stepped Purple Pyramid Roof on Tower + Tall Gold Spire Finial
    for (let t = 0; t < 4; t++) {
      const span = 8.4 - t * 1.6;
      const offset = (6.0 - span) / 2;
      block(t % 2 === 0 ? "roof" : "roofLight", -10 + offset, 19.0 + t * 0.85, -9 + offset, span, 0.9, span);
    }
    block("gold", -7.9, 22.4, -6.9, 1.8, 1.1, 1.8);
    block("gold", -7.45, 23.5, -6.45, 0.9, 1.8, 0.9);

    // Right Steep Gold-Trimmed Purple Gable Wing (x: -4..7, z: -10..0, y: 2..10)
    addTimberWalls(block, -4, 7, -10, 0, 2, 10, 2);
    block("beam", -4.2, 9.8, -10.2, 12.4, 0.85, 11.4);
    addSteppedFrontGable(block, -5, 8, -11, 1, 10, 0.92, "gold", true);

    // Upper shuttered gable window + Front purple door with arch awning + 2 wall lanterns
    addFrontWindow(block, 1.5, 11.5, 0, true, true);
    addFrontDoor(block, 1.5, 2, 0, "door", true);
    block("lantern", -1.8, 4.8, 0.55, 0.85, 1.15, 0.85);
    block("lantern", 4.2, 4.8, 0.55, 0.85, 1.15, 0.85);

    // Far-left low garden lantern post + lush purple & white flower borders
    addLampPost(block, -10.4, 2.0, -1.2, 1.2);
    for (const [fx, fz, col] of [
      [-9.6, -1.8, "purpleFlower"],
      [-7.8, -1.6, "white"],
      [-5.8, -1.4, "purpleFlower"],
      [-3.5, 0.8, "white"],
      [4.5, 0.8, "purpleFlower"],
      [6.2, 0.6, "pink"],
    ]) {
      addFlowerPatch(block, fx, 2.0, fz, col);
    }
  } else if (kind === "garden") {
    // ── IMAGE 4: All-Purple Cross-Gable Cottage with Right Glass Conservatory / Sunroom ──
    addTerrace(block, -11, 10, -12, 2, 2, "stone", "stoneDark");
    for (let s = 0; s < 3; s++) {
      block("stoneLight", -7.2, (2 - s) * 0.65, 1.2 + s * 0.9, 4.8, 0.7, 1.0);
    }
    // Stone & wooden fence posts flanking front steps
    for (const px of [-9.6, -7.8, -2.2, -0.4]) {
      block("stone", px, 2.0, 1.4, 1.1, 1.6, 1.1);
      block("beam", px + 0.2, 2.3, 0.4, 0.5, 1.2, 1.2);
    }

    // Main Left/Back Cottage Body (x: -9..2, z: -11..-1, y: 2..10) + All-Purple Stepped Roof
    addTimberWalls(block, -9, 2, -11, -1, 2, 10, 2);
    block("beam", -9.2, 9.8, -11.2, 12.4, 0.85, 11.4);
    addSteppedFrontGable(block, -10, 3, -12, 0, 10, 0.9, "roofLight", true);
    // Upper-right cross-gable + stone chimney with purple cap
    for (let z = -10; z <= -3; z++) {
      const dz = Math.abs(z + 6.5);
      const ry = 11.2 + Math.round((3.5 - dz) * 0.85);
      for (let x = 1; x <= 7; x++) {
        block(x === 7 ? "roofLight" : "roof", x, ry, z, 1, 1.1, 1);
      }
    }
    for (let y = 13; y <= 19; y++) {
      block(y % 2 === 0 ? "stone" : "stoneDark", 1.5, y, -8.5, 2.6, 1.0, 2.6);
    }
    block("roof", 1.1, 20.0, -8.9, 3.4, 0.75, 3.4);

    // Forest-green front door + purple arch awning + shuttered windows + left lanterns
    addFrontDoor(block, -5.2, 2, -1, "door", true);
    addFrontWindow(block, -0.5, 4.2, -1, true, true);
    addFrontWindow(block, -3.5, 11.5, -1, true, true);
    addLampPost(block, -9.8, 2.0, 1.4, 1.1);
    addLampPost(block, -8.8, 2.0, -0.4, 3.2);

    // Right Glass Conservatory / Sunroom (x: 2..9, z: -6..1, y: 2..8)
    addTerrace(block, 2, 9, -6, 1, 4, "stone", "stoneDark");
    // Large glowing glass walls on front (z = 0.8) and right (x = 8.8) with slender cream-white mullions
    block("glass", 2.6, 3.8, 0.6, 6.0, 4.2, 0.35);
    block("glass", 8.6, 3.8, -5.4, 0.35, 4.2, 6.0);
    for (const mx of [2.4, 4.6, 6.8, 8.8]) {
      block("creamFrame", mx, 3.6, 0.75, 0.45, 4.6, 0.48);
    }
    for (const mz of [-5.6, -3.4, -1.2, 0.8]) {
      block("creamFrame", 8.75, 3.6, mz, 0.48, 4.6, 0.45);
    }
    block("creamFrame", 2.3, 8.0, -5.7, 7.0, 0.55, 7.0);

    // Pitched translucent aqua-blue glass roof + slender cream rafters
    for (let x = 2; x <= 9; x++) {
      const ry = 8.5 + (9 - x) * 0.38;
      for (let z = -6; z <= 1; z++) {
        const isRafter = z === -6 || z === -3 || z === -1 || z === 1 || x === 9;
        block(isRafter ? "creamFrame" : "sunGlass", x, ry, z, 1, 0.52, 1);
      }
    }
    // Interior hanging warm lantern inside sunroom
    block("lantern", 5.5, 5.8, -2.5, 0.9, 1.2, 0.9);
    // Lush climbing green ivy vines + 3 overflowing flower boxes around sunroom
    for (let y = 3.5; y <= 8.8; y += 0.9) {
      block("leaf", 2.1, y, 1.0, 0.95, 0.95, 0.85);
      block("leafDark", 8.9, y * 0.92, 0.9, 0.85, 0.9, 0.85);
    }
    block("beam", 2.8, 3.0, 1.1, 5.6, 0.75, 0.95);
    block("leaf", 3.0, 3.7, 1.2, 5.2, 0.55, 0.8);
    block("pink", 3.4, 4.15, 1.3, 0.7, 0.5, 0.6);
    block("white", 4.8, 4.15, 1.3, 0.7, 0.5, 0.6);
    block("pink", 6.4, 4.15, 1.3, 0.7, 0.5, 0.6);
    block("beam", 9.1, 3.0, -5.0, 0.95, 0.75, 5.4);
    block("leaf", 9.2, 3.7, -4.8, 0.8, 0.55, 5.0);
    block("pink", 9.3, 4.15, -4.0, 0.6, 0.5, 0.7);
    block("white", 9.3, 4.15, -2.0, 0.6, 0.5, 0.7);
  } else if (kind === "stone") {
    // ── Steep Purple-Gabled Artisan Lodge with Right 3-Tier Timber Scaffolding Tower (matching reference right-side house) ──
    addTerrace(block, -10, 11, -11, 3, 3, "terrace", "terraceDark");
    for (let s = 0; s < 2; s++) {
      block("stoneLight", -3.2, 1.2 - s * 0.6, 2.8 + s * 0.9, 4.8, 0.7, 1.1);
    }

    // Timber-and-stone 2-story cottage body (x: -8..5, z: -9..1, y: 3..11)
    addTimberWalls(block, -8, 5, -9, 1, 3, 11, 3);
    block("beam", -8.2, 10.6, -9.2, 14.4, 0.85, 11.4);

    // Steep purple front gable roof + side cross-gable
    addSteppedFrontGable(block, -9, 6, -10, 2, 11, 0.92, "roofLight", true);
    for (let z = -8; z <= -1; z++) {
      const dz = Math.abs(z + 4.5);
      const ry = 11.5 + Math.round((3.5 - dz) * 0.85);
      for (let x = -9; x <= 6; x++) {
        block((x + z) % 2 === 0 ? "roof" : "roofLight", x, ry, z, 1, 1.1, 1);
      }
    }

    // Warm glowing front door + mullioned windows on front & sides
    addFrontDoor(block, -1.5, 3, 1, "door", true);
    addFrontWindow(block, 2.5, 4.8, 1, true, true);
    addFrontWindow(block, -1.5, 12.2, 1, true, false);
    for (const sx of [-8.4, 5.4]) {
      block("glass", sx, 5.2, -5.2, 0.5, 2.8, 2.8);
      block("beamDark", sx + (sx > 0 ? 0.35 : -0.15), 6.4, -5.2, 0.3, 0.24, 2.8);
    }

    // Right-side 3-Tier Wooden Scaffolding Tower (x: 5.8..10.4, z: -7..2, y: 3..15)
    for (const [px, pz] of [
      [5.8, -6.5],
      [9.8, -6.5],
      [5.8, -1.5],
      [9.8, -1.5],
      [5.8, 2.2],
      [9.8, 2.2],
    ]) {
      block("beam", px, 3.0, pz, 0.68, 12.2, 0.68);
    }
    for (const py of [6.8, 10.6, 14.2]) {
      block("beam", 5.5, py, -6.8, 5.2, 0.45, 9.6);
    }
    for (let i = 0; i < 4; i++) {
      block("beamDark", 6.2 + i * 0.8, 7.2 + i * 0.8, 2.3, 0.65, 0.75, 0.35);
      block("beamDark", 9.0 - i * 0.8, 7.2 + i * 0.8, 2.3, 0.65, 0.75, 0.35);
    }
    block("lantern", 5.4, 6.2, 2.5, 0.85, 1.15, 0.85);

    for (const [fx, fz, col] of [
      [-8.5, 1.6, "purpleFlower"],
      [-5.5, 1.8, "pink"],
      [2.5, 1.8, "purpleFlower"],
      [-8.8, -2.5, "purpleFlower"],
    ]) {
      addFlowerPatch(block, fx, 3.0, fz, col);
    }
  } else {
    // ── IMAGE 6: Artisan Forge / Hearth Cottage with Blazing Exterior Fireplace & Tall Chimney ──
    addTerrace(block, -11, 9, -11, 3, 3, "terrace", "terraceDark");

    // Massive Left Exterior Stone Forge / Hearth + Arched Firebox + Blazing Fire + Tall Chimney
    for (let y = 3; y <= 8; y++) {
      for (let x = -9; x <= -3; x++) {
        for (let z = -7; z <= 0; z++) {
          const isFireOpening = z >= -2 && x >= -7 && x <= -5 && y <= 6;
          if (isFireOpening) continue;
          block((x + y + z) % 2 === 0 ? "stone" : "stoneDark", x, y, z);
        }
      }
    }
    // Stepped stone arch around firebox opening + blazing multi-layered fire flames
    block("stoneLight", -8.0, 6.6, -0.4, 4.4, 1.0, 1.1);
    block("stoneLight", -7.2, 7.4, -0.3, 2.8, 0.8, 1.1);
    block("fire", -7.0, 3.2, -1.8, 2.4, 2.2, 1.6);
    block("lantern", -6.5, 3.6, -1.2, 1.4, 1.5, 1.2);
    block("gold", -6.2, 4.2, -0.9, 0.8, 1.1, 0.8);
    // Stepped pyramidal stone hood (y: 8.5..11.5) + Very Tall Stone Chimney (y: 11.5..21.5)
    block("stone", -8.4, 8.8, -6.4, 5.2, 1.4, 5.2);
    block("stoneDark", -7.8, 10.2, -5.8, 4.0, 1.4, 4.0);
    for (let y = 11.5; y <= 21.0; y++) {
      block(Math.round(y) % 2 === 0 ? "stone" : "stoneDark", -7.2, y, -5.2, 2.8, 1.0, 2.8);
    }
    block("stoneLight", -7.6, 21.8, -5.6, 3.6, 0.75, 3.6);
    block("smoke", -6.4, 23.0, -4.4, 1.3, 1.0, 1.3);
    block("smoke", -5.8, 24.4, -3.8, 1.7, 1.2, 1.7);
    block("smoke", -5.1, 26.0, -3.2, 2.1, 1.3, 2.1);
    // Stacked firewood logs on left terrace ledge
    addStackedLogs(block, -10.8, 3.0, -4.5, 3);

    // Right Cottage Wing with Dual Purple Gable Roofs (x: -3..8, z: -10..0, y: 3..10)
    addTimberWalls(block, -3, 8, -10, 0, 3, 10, 2);
    addSteppedFrontGable(block, -3, 8, -11, -1, 10, 0.88, "roofLight", true);
    addSteppedFrontGable(block, 1, 8, -3, 1, 8.6, 0.82, "roofLight", true);

    // Wooden door + hanging lantern + potted flower planter + right glowing window
    addFrontDoor(block, -0.5, 3, 0, "door", false);
    block("lantern", 1.6, 5.6, 0.55, 0.85, 1.15, 0.85);
    block("beam", 1.5, 3.0, 0.6, 1.3, 1.1, 1.3);
    block("leaf", 1.65, 4.1, 0.75, 1.0, 0.55, 1.0);
    block("pink", 1.85, 4.55, 0.9, 0.55, 0.45, 0.55);
    addFrontWindow(block, 4.8, 4.8, 0, false, false);

    for (const [fx, fz, col] of [
      [-10.4, 1.8, "purpleFlower"],
      [-7.5, 2.0, "white"],
      [-4.2, 2.1, "purpleFlower"],
      [2.2, 2.1, "purpleFlower"],
      [5.8, 1.9, "pink"],
    ]) {
      addFlowerPatch(block, fx, 3.0, fz, col);
    }
  }

  return group(materials);
}

function buildWorkshop() {
  const materials = makeMaterials({
    plaster: 0xbfa78c,
    plasterRoughness: 0.84,
    stone: 0x625d6e,
    stoneLight: 0x7a7488,
    stoneDark: 0x454152,
    roof: 0x5832a4,
    roofLight: 0x744bcb,
    roofDeep: 0x3d2076,
    shutter: 0x643ab8,
    beam: 0x5e3b1f,
    beamDark: 0x3d2411,
    gold: 0xc8923b,
    glassIntensity: 2.5,
    lanternIntensity: 2.5,
  });
  // Fine micro-voxel scale for the central Grand Clockwork Cathedral Workshop
  const S = 0.16;
  const { block, group } = createBuilder(S);

  // 1. Stepped stone acropolis terrace floor (x: -12..14, z: -10..5)
  addTerrace(block, -12, 14, -10, 5, 2, "stone", "stoneDark");
  for (let s = 0; s < 3; s++) {
    block("stoneLight", -4.2, (2 - s) * 0.65, 5.0 + s * 0.9, 6.4, 0.7, 1.1);
  }

  // 2. Main 2-Story Cathedral Workshop Hall (x: -10..6, z: -9..2, y: 2..12)
  addTimberWalls(block, -10, 6, -9, 2, 2, 12, 3);
  block("beam", -10.3, 7.2, -9.3, 17.6, 0.85, 12.6);
  block("beam", -10.3, 11.8, -9.3, 17.6, 0.9, 12.6);

  // Projecting Front Clockwork Gable Wing (x: -7..3, z: -3..4, y: 2..12)
  addTimberWalls(block, -7, 3, -3, 4, 2, 12, 3);
  block("beam", -7.3, 7.2, -3.2, 11.6, 0.85, 8.4);

  // Arched Double Timber Portal on Front Gable (x: -4.2..0.2, y: 2..7, z: 4)
  addFrontDoor(block, -2.0, 2, 4, "beamDark", false);
  block("stoneLight", -5.2, 2.0, 4.4, 1.2, 5.6, 1.1);
  block("stoneLight", 0.2, 2.0, 4.4, 1.2, 5.6, 1.1);
  block("stoneLight", -5.0, 7.2, 4.5, 6.2, 1.1, 1.2);
  block("lantern", -5.8, 5.2, 4.9, 0.9, 1.25, 0.9);
  block("lantern", 1.2, 5.2, 4.9, 0.9, 1.25, 0.9);

  // Warm glowing mullioned windows flanking the portal & on upper dormers
  addFrontWindow(block, -8.5, 4.2, 2, false, true);
  addFrontWindow(block, 4.5, 4.2, 2, false, true);
  addFrontWindow(block, 4.5, 8.8, 2, false, false);
  addFrontWindow(block, -8.5, 8.8, 2, false, false);

  // 3. Transverse Steep Purple Roof (ridge along X, z: -10..3) + Intersecting Front Steep Purple Gable (ridge along Z, x: -8..4)
  const midZ = -3.5;
  for (let z = -10; z <= 3; z++) {
    const dz = Math.abs(z - midZ);
    const ry = 12.0 + Math.round((6.5 - dz) * 0.92);
    for (let x = -11; x <= 7; x++) {
      const isEdge = x === -11 || x === 7;
      block(isEdge ? "beam" : (x + z) % 2 === 0 ? "roof" : "roofLight", x, ry, z, 1, 1.15, 1);
    }
  }
  addSteppedFrontGable(block, -8, 4, -4, 5, 12, 0.98, "beam", true);

  // 4. Central Bell-Tower Lantern Turret rising from the roof crossing (x: -4.5..0.5, z: -6..-1, y: 15..22) + Stepped Purple Spire
  for (let y = 15; y <= 21; y++) {
    for (let x = -5; x <= 1; x++) {
      for (let z = -6; z <= 0; z++) {
        const edge = x === -5 || x === 1 || z === -6 || z === 0;
        if (!edge) continue;
        const isCorner = (x === -5 || x === 1) && (z === -6 || z === 0);
        const isWin = y >= 17 && y <= 19 && ((x >= -3 && x <= -1) || (z >= -4 && z <= -2));
        block(isCorner ? "beam" : isWin ? "lantern" : "plaster", x, y, z);
      }
    }
  }
  block("beam", -5.4, 21.2, -6.4, 7.8, 0.85, 7.8);
  for (let t = 0; t < 6; t++) {
    const span = 8.2 - t * 1.25;
    const off = (6.0 - span) / 2;
    block(t % 2 === 0 ? "roof" : "roofLight", -5 + off, 22.0 + t * 0.88, -6 + off, span, 0.92, span);
  }
  block("roofLight", -2.4, 27.2, -3.4, 0.9, 2.0, 0.9);

  // 5. Right Side Purple-Roofed Annex (x: 4..9, z: -2..4, y: 2..8) + Glowing Windows
  addTimberWalls(block, 4, 9, -2, 4, 2, 8, 2);
  addSteppedFrontGable(block, 4, 9, -2, 4, 8, 0.82, "beam", true);
  addFrontWindow(block, 6.5, 4.0, 4, false, false);

  // 6. Towering 4-Tier Wooden Scaffolding Tower on the Right (x: 9.2..14.4, z: -6..3, y: 2..20)
  const posts = [
    [9.4, -5.5],
    [13.6, -5.5],
    [9.4, -1.0],
    [13.6, -1.0],
    [9.4, 3.0],
    [13.6, 3.0],
  ];
  for (const [px, pz] of posts) {
    block("beam", px, 2.0, pz, 0.72, 18.2, 0.72);
  }
  for (const py of [6.2, 10.5, 14.8, 18.8]) {
    block("beam", 9.0, py, -5.8, 5.6, 0.48, 9.6);
  }
  for (let tier = 0; tier < 3; tier++) {
    const by = 6.6 + tier * 4.2;
    for (let i = 0; i < 4; i++) {
      block("beamDark", 9.8 + i * 0.85, by + i * 0.85, 3.1, 0.65, 0.75, 0.35);
      block("beamDark", 12.8 - i * 0.85, by + i * 0.85, 3.1, 0.65, 0.75, 0.35);
    }
  }
  block("lantern", 9.2, 9.2, 3.3, 0.85, 1.15, 0.85);
  block("lantern", 13.4, 13.5, 3.3, 0.85, 1.15, 0.85);

  const root = group(materials);
  // 7. Giant Wooden & Bronze Clockwork Gear Emblem on the Front Gable Wall
  const gear = new THREE.Group();
  gear.name = "Gear";
  gear.position.set(-2.0 * S, 11.4 * S, 5.25 * S);
  const ringOuter = new THREE.Mesh(new THREE.BoxGeometry(4.2 * S, 4.2 * S, 0.65 * S), materials.gold);
  const ringInner = new THREE.Mesh(new THREE.BoxGeometry(2.2 * S, 2.2 * S, 0.78 * S), materials.beamDark);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(1.2 * S, 1.2 * S, 0.9 * S), materials.gold);
  gear.add(ringOuter, ringInner, hub);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.15 * S, 1.15 * S, 0.72 * S), materials.gold);
    tooth.position.set(Math.cos(a) * 2.85 * S, Math.sin(a) * 2.85 * S, 0);
    tooth.rotation.z = a;
    gear.add(tooth);
  }
  root.add(gear);
  return root;
}

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      setTimeout(() => this.onloadend?.(), 0);
    });
  }
};

const exporter = new GLTFExporter();
const files = [
  ["cottage-violet.glb", buildCottage("violet")],
  ["cottage-timber.glb", buildCottage("timber")],
  ["cottage-lantern.glb", buildCottage("lantern")],
  ["cottage-garden.glb", buildCottage("garden")],
  ["cottage-stone.glb", buildCottage("stone")],
  ["cottage-hearth.glb", buildCottage("hearth")],
  ["workshop.glb", buildWorkshop()],
];

for (const [name, root] of files) {
  const data = await exporter.parseAsync(root, { binary: true });
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(data));
  console.log(name, Buffer.from(data).length);
}

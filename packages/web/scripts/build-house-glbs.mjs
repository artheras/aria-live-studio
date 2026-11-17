import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../public/models");

function makeMaterials(colors) {
  const std = (color, roughness, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: extra.metalness ?? 0, ...extra });
  return {
    plaster: std(colors.plaster, colors.plasterRoughness ?? 0.78),
    stone: std(colors.stone ?? 0xb7b2a8, 0.92),
    stoneDark: std(colors.stoneDark ?? 0x8a847c, 0.95),
    beam: std(colors.beam ?? 0x8a5a32, colors.beamRoughness ?? 0.8),
    roof: std(colors.roof, colors.roofRoughness ?? 0.42, { metalness: colors.roofMetalness ?? 0.12 }),
    roofLight: std(colors.roofLight, Math.max(0.28, (colors.roofRoughness ?? 0.42) - 0.06), {
      metalness: Math.max(0, (colors.roofMetalness ?? 0.12) - 0.04),
    }),
    door: std(colors.door ?? 0x7a45c4, 0.46),
    glass: std(colors.glass ?? 0xffe1a8, 0.28, {
      emissive: colors.glassEmissive ?? 0xff9a32,
      emissiveIntensity: colors.glassIntensity ?? 0.9,
    }),
    shutter: std(colors.shutter ?? 0x6842ae, 0.55),
    leaf: std(0x3d8c46, 0.72),
    pink: std(0xe672a5, 0.55),
    white: std(0xf7f1ea, 0.52),
    gold: std(0xe7b84a, 0.42, { metalness: 0.28 }),
    lantern: std(0xffe49e, 0.3, { emissive: 0xffa028, emissiveIntensity: colors.lanternIntensity ?? 1.05 }),
    log: std(colors.log ?? 0xa86b3c, 0.86),
    smoke: std(0xf3eee8, 0.95, { transparent: true, opacity: 0.72 }),
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

function buildCottage(kind) {
  const palettes = {
    violet: { plaster: 0xf4ecdf, roof: 0x6b45b8, roofLight: 0x8d6ad8, roofRoughness: 0.34, roofMetalness: 0.18 },
    timber: {
      plaster: 0xe4c49a,
      plasterRoughness: 0.84,
      roof: 0x7a3d4a,
      roofLight: 0xa45a62,
      roofRoughness: 0.6,
      roofMetalness: 0.02,
      beam: 0x4a2914,
      beamRoughness: 0.9,
      log: 0x8a5528,
    },
    lantern: {
      plaster: 0xe6e0f4,
      roof: 0x6a4ec4,
      roofLight: 0x9a78e4,
      roofRoughness: 0.28,
      roofMetalness: 0.16,
      glassIntensity: 1.85,
      lanternIntensity: 1.7,
    },
    garden: {
      plaster: 0xe4efe0,
      plasterRoughness: 0.86,
      roof: 0x5a4a78,
      roofLight: 0x7d6aa4,
      roofRoughness: 0.72,
      roofMetalness: 0,
      beam: 0x5c4030,
    },
    stone: {
      plaster: 0xb7c4ce,
      plasterRoughness: 0.94,
      stone: 0x8ea0ae,
      stoneDark: 0x5e6e80,
      roof: 0x6a6284,
      roofLight: 0x8a82a4,
      roofRoughness: 0.8,
      roofMetalness: 0.1,
      beam: 0x5a4638,
      glassIntensity: 0.7,
    },
    hearth: {
      plaster: 0xd8c0aa,
      plasterRoughness: 0.88,
      stone: 0x8a6858,
      stoneDark: 0x5c4036,
      roof: 0x6b3844,
      roofLight: 0x8a5048,
      roofRoughness: 0.5,
      roofMetalness: 0.06,
      beam: 0x4a2c1c,
      glass: 0xffc07a,
      glassEmissive: 0xff6a1a,
      glassIntensity: 1.45,
    },
  };
  const materials = makeMaterials(palettes[kind]);
  const { block, group } = createBuilder(0.26);
  const wall = kind === "stone" ? "stone" : "plaster";

  for (let x = -5; x <= 4; x++) {
    for (let z = -8; z <= -1; z++) block("stoneDark", x, 0, z);
  }

  const roofTop = (x) => 8 - Math.abs(x + 0.5);
  for (let y = 0; y <= 7; y++) {
    for (let x = -5; x <= 4; x++) {
      for (let z = -8; z <= -1; z++) {
        const edge = x === -5 || x === 4 || z === -8 || z === -1;
        if (!edge || y >= roofTop(x)) continue;
        const door = z === -1 && x >= -2 && x <= 1 && y >= 1 && y <= 3;
        const winL = z === -1 && (x === -4 || x === -3) && y >= 3 && y <= 4;
        const winR = z === -1 && (x === 2 || x === 3) && y >= 3 && y <= 4;
        const sideWin = x === 4 && z === -5 && y >= 3 && y <= 4;
        const backWin = z === -8 && (x === -2 || x === -1) && y >= 3 && y <= 4;
        if (door || winL || winR || sideWin || backWin) {
          if (y >= 3) block("glass", x, y, z);
          continue;
        }
        const corner = (x === -5 || x === 4) && (z === -8 || z === -1);
        const band = y === 0 || y === 5;
        block(y === 0 ? "stone" : corner || band ? "beam" : wall, x, y, z);
      }
    }
  }

  for (let x = -6; x <= 5; x++) {
    const y = roofTop(x);
    for (let z = -9; z <= 0; z++) {
      block((x + z) % 2 === 0 ? "roof" : "roofLight", x, y, z, 1, 0.55, 1);
    }
  }

  block("door", -2.1, 1, -0.55, 4.2, 3.15, 0.42);
  block("door", -1, 4, -0.55, 2, 0.7, 0.45);
  block("shutter", -2.15, 3.6, -0.55, 0.55, 0.45, 0.35);
  for (const x of [-4.2, 3.2]) {
    block("shutter", x, 3, -0.62, 0.35, 2, 0.22);
    block("beam", x + 0.9, 2.55, -0.45, 1.7, 0.35, 0.4);
    block("leaf", x + 0.9, 2.85, -0.2, 1.4, 0.22, 0.28);
    block("pink", x + 0.5, 3.05, -0.05, 0.35, 0.3, 0.3);
    block("white", x + 1.15, 3.02, -0.02, 0.28, 0.26, 0.28);
    block("gold", x + 0.85, 3.08, 0.02, 0.26, 0.24, 0.24);
  }
  block("glass", -0.5, 5.15, -0.7, 1.2, 1.1, 0.2);
  block("shutter", -1.35, 5.15, -0.55, 0.28, 1.1, 0.2);
  block("shutter", 0.35, 5.15, -0.55, 0.28, 1.1, 0.2);

  for (const x of [-3.2, 2.2]) {
    block("stoneDark", x, 0, 0.35, 0.35, 2.4, 0.35);
    block("lantern", x, 2.35, 0.45, 0.62, 0.7, 0.55);
    block("beam", x, 2.7, 0.35, 0.55, 0.16, 0.5);
  }
  block("stone", -2.5, 0, 0.15, 5, 0.45, 1);
  block("stone", -2.2, 0, 1.15, 4.2, 0.28, 1);
  block("beam", -4.3, 0.7, 1.3, 0.2, 1.1, 0.2);
  block("beam", 3.3, 0.7, 1.3, 0.2, 1.1, 0.2);
  block("beam", -0.5, 1.15, 1.3, 7.4, 0.14, 0.14);

  block("stone", 2.2, 6.2, -5, 1.3, 3.2, 1.3);
  block("stoneDark", 2.05, 9.2, -5.1, 1.6, 0.4, 1.6);
  block("smoke", 2.5, 9.7, -4.7, 0.45, 0.35, 0.45);
  block("smoke", 2.8, 10.05, -4.4, 0.55, 0.35, 0.55);

  for (const x of [6, 8]) {
    block("beam", x, 0, -6, 0.4, 3.2, 0.4);
    block("beam", x, 0, -3.2, 0.35, 2.6, 0.35);
  }
  block("roof", 5.7, 3.05, -6.2, 2.8, 0.28, 3.6);
  block("log", 6.7, 0, -4.6, 1.5, 0.7, 0.7);
  block("log", 6.85, 0.65, -4.55, 1.2, 0.45, 0.55);

  if (kind === "timber") {
    for (const x of [-2.5, 0.5]) block("beam", x, 1, -0.55, 0.22, 3.4, 0.18);
    block("log", 7.4, 0, -4.2, 1.1, 0.9, 1.3);
  }
  if (kind === "lantern") {
    for (const [x, z] of [[-5.4, -1.2], [4.6, -1.2], [-5.4, -7.4], [4.6, -7.4]]) {
      block("beam", x, 0, z, 0.22, 2.2, 0.22);
      block("lantern", x, 2.15, z, 0.4, 0.4, 0.4);
    }
  }
  if (kind === "garden") {
    for (const x of [-5.2, 4.2]) {
      block("leaf", x, 1.1, -0.15, 0.55, 3.6, 0.4);
      block("pink", x, 3.6, 0.15, 0.55, 0.5, 0.5);
      block("white", x + 0.2, 2.2, 0.05, 0.3, 0.28, 0.3);
    }
  }
  if (kind === "stone") {
    block("stoneDark", -2.6, 1, -0.28, 0.75, 3.6, 0.6);
    block("stoneDark", 1.5, 1, -0.28, 0.75, 3.6, 0.6);
    block("stone", -2.3, 4.25, -0.2, 4.8, 0.6, 0.7);
  }
  if (kind === "hearth") {
    block("stone", -5.5, 0, 0.35, 1.7, 1.9, 1.4);
    block("stoneDark", -5.5, 1.7, 0.4, 1.05, 0.85, 1.0);
    block("glass", -5.5, 0.55, 1.05, 0.7, 0.55, 0.22);
    block("smoke", -5.1, 2.2, 0.5, 0.35, 0.28, 0.35);
  }

  return group(materials);
}

function buildWorkshop() {
  const materials = makeMaterials({
    plaster: 0xc4b8a8,
    plasterRoughness: 0.86,
    roof: 0x4e3d86,
    roofLight: 0x6e58aa,
    roofRoughness: 0.46,
    roofMetalness: 0.08,
    beam: 0x6b4224,
    lanternIntensity: 0.75,
  });
  const { block, group } = createBuilder(0.3);

  for (let x = -6; x <= 5; x++) {
    for (let z = -5; z <= 2; z++) block((x + z) % 3 === 0 ? "stoneDark" : "stone", x, 0, z);
  }
  for (let y = 1; y <= 4; y++) {
    for (let x = -6; x <= 5; x++) {
      const win = y >= 2 && y <= 3 && x >= -1 && x <= 1;
      if (win) block("glass", x, y, -5);
      else block(y === 1 || x === -6 || x === 5 ? "beam" : "plaster", x, y, -5);
    }
    block("beam", -6, y, -5);
    block("beam", 5, y, -5);
  }
  for (let y = 1; y <= 4; y++) {
    for (let z = -4; z <= 2; z++) {
      block("plaster", -6, y, z);
      if (z !== 1) block("beam", 5, y, z);
    }
  }
  block("beam", -6, 1, 2, 0.8, 4, 0.8);
  block("beam", 5, 1, 2, 0.8, 4, 0.8);
  for (let x = -7; x <= 6; x++) {
    const edge = Math.abs(x + 0.5) > 4;
    const y = edge ? 5 : 6.2;
    for (let z = -6; z <= 3; z++) block((x + z) % 2 === 0 ? "roof" : "roofLight", x, y, z, 1, 0.45, 1);
  }
  block("gold", -0.5, 6.15, 2.85, 0.9, 0.9, 0.45);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    block("gold", -0.5 + Math.cos(a) * 1.65, 6.15 + Math.sin(a) * 1.65, 3.05, 0.8, 0.8, 0.45);
  }
  block("beam", -3.2, 1, -2, 2.4, 0.2, 0.8);
  block("log", 1.5, 1, -1, 0.9, 0.8, 0.9);
  block("door", 2.2, 1.7, -1.2, 0.7, 0.55, 0.7);
  block("lantern", -5.2, 3.2, 1.6, 0.35, 0.4, 0.35);
  block("lantern", 4.2, 3.2, 1.6, 0.35, 0.4, 0.35);
  block("beam", 7.4, 0, 0.6, 0.55, 6.4, 0.55);
  block("beam", 7.4, 6.1, 0.3, 0.4, 0.4, 3.2);
  block("gold", 7.4, 5.2, 2.8, 0.5, 0.9, 0.5);
  block("door", 7.4, 4.0, 2.9, 0.55, 0.5, 0.55);
  block("stone", -2, 0.15, 2.3, 3.2, 0.35, 0.8);

  return group(materials);
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

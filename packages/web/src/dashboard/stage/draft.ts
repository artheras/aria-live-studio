import * as THREE from "three";
import { buildVoxelInstances, type VoxelSpec } from "./voxels";

export interface StageDraft {
  u: number;
  geo: THREE.BufferGeometry;
  stoneLightSpecs: VoxelSpec[];
  stoneMidSpecs: VoxelSpec[];
  stoneDarkSpecs: VoxelSpec[];
  grassSpecs: VoxelSpec[];
  mossSpecs: VoxelSpec[];
  dirtSpecs: VoxelSpec[];
  timberSpecs: VoxelSpec[];
  trunkSpecs: VoxelSpec[];
  scaffSpecs: VoxelSpec[];
  windowSpecs: VoxelSpec[];
  warmGlassSpecs: VoxelSpec[];
  roofDarkSpecs: VoxelSpec[];
  roofLightSpecs: VoxelSpec[];
  pineSpecs: VoxelSpec[];
  lanternSpecs: VoxelSpec[];
  blossomPinkSpecs: VoxelSpec[];
  blossomGoldSpecs: VoxelSpec[];
  blossomWhiteSpecs: VoxelSpec[];
  smokeSpecs: VoxelSpec[];
  pushStone: (x: number, y: number, z: number, sx?: number, sy?: number, sz?: number) => void;
  pushRoof: (x: number, y: number, z: number, sx?: number, sy?: number, sz?: number) => void;
  pushFramedWindow: (x: number, y: number, z: number, nx: number, nz: number, withSill?: boolean) => void;
  applyFinish: (finish: HouseFinish) => void;
  mount: (parent: THREE.Object3D) => void;
}

export interface HouseFinish {
  plaster?: number;
  plasterRoughness?: number;
  stone?: number;
  stoneDark?: number;
  stoneRoughness?: number;
  timber?: number;
  timberRoughness?: number;
  beam?: number;
  beamRoughness?: number;
  roof?: number;
  roofLight?: number;
  roofRoughness?: number;
  roofMetalness?: number;
  glass?: number;
  glassEmissive?: number;
  glassIntensity?: number;
  lanternIntensity?: number;
}

export function createStageDraft(geo: THREE.BufferGeometry): StageDraft {
  const stoneLightSpecs: VoxelSpec[] = [];
  const stoneMidSpecs: VoxelSpec[] = [];
  const stoneDarkSpecs: VoxelSpec[] = [];
  const grassSpecs: VoxelSpec[] = [];
  const mossSpecs: VoxelSpec[] = [];
  const dirtSpecs: VoxelSpec[] = [];
  const timberSpecs: VoxelSpec[] = [];
  const trunkSpecs: VoxelSpec[] = [];
  const scaffSpecs: VoxelSpec[] = [];
  const windowSpecs: VoxelSpec[] = [];
  const warmGlassSpecs: VoxelSpec[] = [];
  const roofDarkSpecs: VoxelSpec[] = [];
  const roofLightSpecs: VoxelSpec[] = [];
  const pineSpecs: VoxelSpec[] = [];
  const lanternSpecs: VoxelSpec[] = [];
  const blossomPinkSpecs: VoxelSpec[] = [];
  const blossomGoldSpecs: VoxelSpec[] = [];
  const blossomWhiteSpecs: VoxelSpec[] = [];
  const smokeSpecs: VoxelSpec[] = [];

  const stoneLightMat = new THREE.MeshStandardMaterial({ color: 0xd9d0c4, roughness: 0.82 });
  const stoneMidMat = new THREE.MeshStandardMaterial({ color: 0xb7ab9c, roughness: 0.84 });
  const stoneDarkMat = new THREE.MeshStandardMaterial({ color: 0x8d8276, roughness: 0.88 });
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0x6b5040, roughness: 0.92 });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5aa656, roughness: 0.78 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x4c914b, roughness: 0.76 });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x2f7a45, roughness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xc4894a, roughness: 0.74 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c341c, roughness: 0.84 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6d4cb8, roughness: 0.62 });
  const roofLightMat = new THREE.MeshStandardMaterial({ color: 0x8d6ad4, roughness: 0.55 });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0xf0dbff,
    emissive: 0xa855f7,
    emissiveIntensity: 1.35,
    roughness: 0.22,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffe49e,
    emissive: 0xffa028,
    emissiveIntensity: 0.85,
    roughness: 0.28,
  });
  const warmGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffe1a8,
    emissive: 0xff9a32,
    emissiveIntensity: 1.15,
    roughness: 0.28,
  });
  const blossomPinkMat = new THREE.MeshStandardMaterial({ color: 0xe672a5, roughness: 0.62 });
  const blossomGoldMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.58 });
  const blossomWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f1ea, roughness: 0.6 });
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0xf3eee8,
    roughness: 0.95,
    transparent: true,
    opacity: 0.7,
  });

  const pushStone = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const hash = Math.abs(Math.round(x * 7 + y * 11 + z * 13)) % 5;
    const spec = { x, y, z, sx, sy, sz };
    if (hash === 0) stoneLightSpecs.push(spec);
    else if (hash === 4) stoneDarkSpecs.push(spec);
    else stoneMidSpecs.push(spec);
  };
  const pushRoof = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    if (Math.abs(Math.round(x * 2 + z * 2)) % 3 === 0) roofLightSpecs.push({ x, y, z, sx, sy, sz });
    else roofDarkSpecs.push({ x, y, z, sx, sy, sz });
  };
  const pushFramedWindow = (x: number, y: number, z: number, nx: number, nz: number, withSill = false) => {
    warmGlassSpecs.push({ x: x - nx * 0.12, y, z: z - nz * 0.12, sx: 0.78, sy: 0.88, sz: 0.78 });
    timberSpecs.push({
      x: x + nx * 0.08,
      y,
      z: z + nz * 0.08,
      sx: nz !== 0 ? 0.16 : 0.24,
      sy: 0.94,
      sz: nx !== 0 ? 0.16 : 0.24,
    });
    if (withSill) {
      stoneLightSpecs.push({
        x: x + nx * 0.12,
        y: y - 0.24,
        z: z + nz * 0.12,
        sx: nz !== 0 ? 0.98 : 0.34,
        sy: 0.22,
        sz: nx !== 0 ? 0.98 : 0.34,
      });
    }
  };

  const applyFinish = (finish: HouseFinish) => {
    if (finish.plaster !== undefined) stoneLightMat.color.setHex(finish.plaster);
    if (finish.plasterRoughness !== undefined) stoneLightMat.roughness = finish.plasterRoughness;
    if (finish.stone !== undefined) stoneMidMat.color.setHex(finish.stone);
    if (finish.stoneDark !== undefined) stoneDarkMat.color.setHex(finish.stoneDark);
    if (finish.stoneRoughness !== undefined) {
      stoneMidMat.roughness = finish.stoneRoughness;
      stoneDarkMat.roughness = Math.min(1, finish.stoneRoughness + 0.04);
    }
    if (finish.timber !== undefined) woodMat.color.setHex(finish.timber);
    if (finish.timberRoughness !== undefined) woodMat.roughness = finish.timberRoughness;
    if (finish.beam !== undefined) darkWoodMat.color.setHex(finish.beam);
    if (finish.beamRoughness !== undefined) darkWoodMat.roughness = finish.beamRoughness;
    if (finish.roof !== undefined) roofMat.color.setHex(finish.roof);
    if (finish.roofLight !== undefined) roofLightMat.color.setHex(finish.roofLight);
    if (finish.roofRoughness !== undefined) {
      roofMat.roughness = finish.roofRoughness;
      roofLightMat.roughness = Math.max(0.2, finish.roofRoughness - 0.06);
    }
    if (finish.roofMetalness !== undefined) {
      roofMat.metalness = finish.roofMetalness;
      roofLightMat.metalness = Math.max(0, finish.roofMetalness - 0.04);
    }
    if (finish.glass !== undefined) warmGlassMat.color.setHex(finish.glass);
    if (finish.glassEmissive !== undefined) warmGlassMat.emissive.setHex(finish.glassEmissive);
    if (finish.glassIntensity !== undefined) warmGlassMat.emissiveIntensity = finish.glassIntensity;
    if (finish.lanternIntensity !== undefined) lanternMat.emissiveIntensity = finish.lanternIntensity;
  };

  const mount = (parent: THREE.Object3D) => {
    const group = new THREE.Group();
    const add = (mat: THREE.Material, specs: VoxelSpec[], cast = true, receive = true) => {
      if (specs.length === 0) return;
      group.add(buildVoxelInstances(geo, mat, specs, cast, receive));
    };
    add(grassMat, grassSpecs);
    add(mossMat, mossSpecs);
    add(dirtMat, dirtSpecs);
    add(stoneLightMat, stoneLightSpecs);
    add(stoneMidMat, stoneMidSpecs);
    add(stoneDarkMat, stoneDarkSpecs);
    add(darkWoodMat, [...timberSpecs, ...trunkSpecs]);
    add(woodMat, scaffSpecs);
    add(roofMat, roofDarkSpecs);
    add(roofLightMat, roofLightSpecs);
    add(pineMat, pineSpecs);
    add(blossomPinkMat, blossomPinkSpecs);
    add(blossomGoldMat, blossomGoldSpecs);
    add(blossomWhiteMat, blossomWhiteSpecs);
    add(smokeMat, smokeSpecs, false, false);
    add(warmGlassMat, warmGlassSpecs, false, false);
    add(crystalMat, windowSpecs, false, false);
    add(lanternMat, lanternSpecs, false, false);
    parent.add(group);
  };

  return {
    u: 0.5,
    geo,
    stoneLightSpecs,
    stoneMidSpecs,
    stoneDarkSpecs,
    grassSpecs,
    mossSpecs,
    dirtSpecs,
    timberSpecs,
    trunkSpecs,
    scaffSpecs,
    windowSpecs,
    warmGlassSpecs,
    roofDarkSpecs,
    roofLightSpecs,
    pineSpecs,
    lanternSpecs,
    blossomPinkSpecs,
    blossomGoldSpecs,
    blossomWhiteSpecs,
    smokeSpecs,
    pushStone,
    pushRoof,
    pushFramedWindow,
    applyFinish,
    mount,
  };
}

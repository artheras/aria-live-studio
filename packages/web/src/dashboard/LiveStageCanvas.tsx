import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { LiveState } from "@aria-live/shared";
import { truncate } from "../lib/time";

interface VoxelSpec {
  x: number;
  y: number;
  z: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

interface BurstCube {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

function buildVoxelInstances(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  specs: VoxelSpec[],
  castShadow = true,
  receiveShadow = true,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, specs.length);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  const dummy = new THREE.Object3D();
  specs.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(s.sx ?? 1, s.sy ?? 1, s.sz ?? 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function resolveThemePalette(prompt?: string | null, modifiers?: string[]) {
  const text = `${prompt ?? ""} ${(modifiers ?? []).join(" ")}`.toLowerCase();
  if (/boss|fight|combat|dragon|danger/.test(text)) {
    return { top: 0x1a0b18, mid: 0x5c1d3b, horizon: 0xf28b66, crystal: 0xff4d6d };
  }
  if (/retro|pixel|cyber|neon|sci-fi/.test(text)) {
    return { top: 0x0c192c, mid: 0x22426b, horizon: 0x7fd4d0, crystal: 0x2dd4bf };
  }
  if (/library|enchanted|magic|arcane|float/.test(text)) {
    return { top: 0x140d2b, mid: 0x4c2c7a, horizon: 0xf0ab70, crystal: 0xb589ff };
  }
  return { top: 0x16112e, mid: 0x4b3175, horizon: 0xf29f6d, crystal: 0xa855f7 };
}

/** Interactive 3D voxel workshop island powered by Three.js with OrbitControls & 3D-projected idea bubbles. */
export function LiveStageCanvas({
  state,
  transparent = false,
  ecoMode = false,
  compact = false,
}: {
  state: LiveState;
  transparent?: boolean;
  ecoMode?: boolean;
  compact?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const ecoModeRef = useRef(ecoMode);
  ecoModeRef.current = ecoMode;

  const [webglReady, setWebglReady] = useState(true);

  const prevPhaseRef = useRef(state.round?.phase ?? "idle");
  const lastCelebrationIdRef = useRef<string | null>(null);
  const burstFnRef = useRef<((colorHex: number, origin?: { x: number; y: number; z: number }) => void) | null>(null);
  const petUntilRef = useRef<number>(0);

  useEffect(() => {
    prevPhaseRef.current = state.round?.phase ?? "idle";
  }, [state.round?.phase]);

  useEffect(() => {
    const latest = state.celebrations?.at(-1);
    if (!latest || latest.id === lastCelebrationIdRef.current) return;
    lastCelebrationIdRef.current = latest.id;
  }, [state.celebrations]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent, powerPreference: "high-performance" });
    } catch {
      setWebglReady(false);
      return;
    }

    const width = Math.max(320, container.clientWidth || 640);
    const height = Math.max(180, container.clientHeight || 360);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    if (transparent) renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x6e5a86, 48, 110);

    // Balanced 3/4 isometric view framing the entire floating island, deep cliff roots, and castle.
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 180);
    camera.position.set(compact ? 17.2 : 16.0, compact ? 8.8 : 8.2, compact ? 18.0 : 16.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controls.minDistance = 5.5;
    controls.maxDistance = 34;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.target.set(0.2, compact ? 0.35 : 0.25, 0.0);

    // Twilight sky dome: deep indigo-purple top -> soft violet mid -> warm peach horizon
    const skyGeo = new THREE.SphereGeometry(76, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x140f29) },
        midColor: { value: new THREE.Color(0x452d6b) },
        horizonColor: { value: new THREE.Color(0xd99b82) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        varying vec3 vWorldPosition;
        void main() {
          vec3 dir = normalize(vWorldPosition);
          float h = dir.y;
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.42, -0.08, h));
          col = mix(col, topColor, smoothstep(-0.12, 0.22, h));
          float sunGlow = pow(max(dot(dir, normalize(vec3(0.58, -0.1, 0.8))), 0.0), 3.2);
          col = mix(col, vec3(0.98, 0.80, 0.58), sunGlow * 0.52);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    if (!transparent) {
      scene.add(new THREE.Mesh(skyGeo, skyMat));
    }

    // Balanced 3-point twilight lighting so shadow-side stone bricks stay legible & richly textured
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x6d8b62, 0.78));

    const sun = new THREE.DirectionalLight(0xffd7a8, 2.7);
    sun.position.set(8, 12, 14);
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.62);
    fill.position.set(-6, 7, 8);
    scene.add(fill);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 48;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const porchLight = new THREE.PointLight(0xffb44c, 1.6, 4.5);
    porchLight.position.set(1.55, 1.18, 0.85);
    scene.add(porchLight);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    // 0.5-unit beveled sub-voxel unit gives crisp brick edges & highlights
    const u = 0.5;
    const voxelGeo = new RoundedBoxGeometry(0.472, 0.472, 0.472, 2, 0.042);

    const stoneLightMat = new THREE.MeshStandardMaterial({ color: 0xd9d0c4, roughness: 0.82 });
    const stoneMidMat = new THREE.MeshStandardMaterial({ color: 0xb7ab9c, roughness: 0.84 });
    const stoneDarkMat = new THREE.MeshStandardMaterial({ color: 0x8d8276, roughness: 0.88 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x6b5040, roughness: 0.92 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5aa656, roughness: 0.78 });
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x4c914b, roughness: 0.76 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2f7a45, roughness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xc4894a, roughness: 0.74 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c341c, roughness: 0.84 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x332d45, roughness: 0.74 });
    const roofLightMat = new THREE.MeshStandardMaterial({ color: 0x433b59, roughness: 0.72 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xf0dbff,
      emissive: 0xa855f7,
      emissiveIntensity: 1.65,
      roughness: 0.22,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe49e,
      emissive: 0xffa028,
      emissiveIntensity: 0.85,
      roughness: 0.28,
    });

    const stoneLightSpecs: VoxelSpec[] = [];
    const stoneMidSpecs: VoxelSpec[] = [];
    const stoneDarkSpecs: VoxelSpec[] = [];
    const pushStone = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const hash = Math.abs(Math.round(x * 7 + y * 11 + z * 13)) % 5;
      const spec = { x, y, z, sx, sy, sz };
      if (hash === 0) stoneLightSpecs.push(spec);
      else if (hash === 4) stoneDarkSpecs.push(spec);
      else stoneMidSpecs.push(spec);
    };

    const grassSpecs: VoxelSpec[] = [];
    const mossSpecs: VoxelSpec[] = [];
    const dirtSpecs: VoxelSpec[] = [];
    const timberSpecs: VoxelSpec[] = [];
    const scaffSpecs: VoxelSpec[] = [];
    const windowSpecs: VoxelSpec[] = [];
    const roofDarkSpecs: VoxelSpec[] = [];
    const roofLightSpecs: VoxelSpec[] = [];
    const pineSpecs: VoxelSpec[] = [];
    const lanternSpecs: VoxelSpec[] = [];

    const pushRoof = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      if (Math.abs(Math.round(x * 2 + z * 2)) % 3 === 0) roofLightSpecs.push({ x, y, z, sx, sy, sz });
      else roofDarkSpecs.push({ x, y, z, sx, sy, sz });
    };

    const pushFramedWindow = (x: number, y: number, z: number, nx: number, nz: number, withSill = false) => {
      windowSpecs.push({ x: x - nx * 0.12, y, z: z - nz * 0.12, sx: 0.78, sy: 0.88, sz: 0.78 });
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

    // 1. Wider floating cliff, about 41 across, with the cottage still near the middle.
    for (let gx = -20; gx <= 20; gx++) {
      for (let gz = -20; gz <= 20; gz++) {
        const x = gx * u;
        const z = gz * u;
        const dist = Math.abs(gx) + Math.abs(gz);
        const maxC = Math.max(Math.abs(gx), Math.abs(gz));
        if (maxC > 20 || dist > 29) continue;

        const onUpperTerrace = gx >= -6 && gx <= 7 && gz >= -7 && gz <= 2;
        if (onUpperTerrace) {
          pushStone(x, 0.5, z);
          pushStone(x, 0.0, z);
        } else {
          if ((gx + gz) % 3 === 0) mossSpecs.push({ x, y: 0.04, z });
          else grassSpecs.push({ x, y: 0.0, z });
        }

        // Deep craggy inverted-cone cliff underside matching the wider 33x33 island
        if (dist <= 29) dirtSpecs.push({ x, y: -0.5, z });
        if (dist <= 27 && (maxC <= 19 || (gx + gz) % 2 === 0)) pushStone(x, -1.0, z);
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

    // Refined stone porch landing + 5-step L-shaped stair + twin timber handrails
    for (let s = 0; s < 5; s++) {
      pushStone(1.42, 0.06 + s * 0.14, 2.38 - s * 0.26, 1.24, 0.42, 0.68);
    }
    pushStone(1.42, 0.76, 0.92, 1.48, 0.42, 1.25);
    pushStone(1.12, 0.76, 0.28, 1.15, 0.42, 1.25);
    timberSpecs.push(
      { x: 1.88, y: 0.48, z: 2.38, sx: 0.12, sy: 0.85, sz: 0.12 },
      { x: 1.88, y: 0.88, z: 1.62, sx: 0.12, sy: 1.05, sz: 0.12 },
      { x: 1.88, y: 1.18, z: 0.88, sx: 0.12, sy: 1.0, sz: 0.12 },
      { x: 1.88, y: 1.05, z: 1.62, sx: 0.1, sy: 0.1, sz: 1.75 },
      { x: 1.04, y: 0.62, z: 2.38, sx: 0.1, sy: 0.75, sz: 0.1 },
      { x: 1.04, y: 1.08, z: 0.88, sx: 0.1, sy: 0.9, sz: 0.1 },
      { x: 1.04, y: 1.08, z: 1.62, sx: 0.09, sy: 0.09, sz: 1.75 },
    );

    // 3. Main Two-Story Gabled Manor Hall (fine 0.5u stone masonry, dark wood door, arched purple windows)
    for (let gy = 2; gy <= 7; gy++) {
      const y = gy * u;
      for (let gx = -5; gx <= 2; gx++) {
        for (let gz = -4; gz <= 2; gz++) {
          const isOuter = gx === -5 || gx === 2 || gz === -4 || gz === 2;
          if (!isOuter) continue;
          const x = gx * u;
          const z = gz * u;
          const isDoor = gx === 2 && (gz === 0 || gz === 1) && (gy === 2 || gy === 3);
          const isFrontWin =
            gz === 2 &&
            (((gy === 2 || gy === 3) && (gx === -4 || gx === -3)) ||
              ((gy === 4 || gy === 5) && (gx === -2 || gx === -1)));
          const isUpperTimber = gz === 2 && gy >= 5 && !isDoor;
          const isBackWin = gz === -4 && (gx === -3 || gx === 0) && (gy === 4 || gy === 5);
          const isSideWin = gx === -5 && (gz === -1 || gz === 0) && (gy === 4 || gy === 5);
          const isCorner = (gx === -5 || gx === 2) && (gz === -4 || gz === 2);

          if (isDoor) {
            timberSpecs.push({ x: x - 0.1, y, z, sx: 0.42, sy: 0.95, sz: 0.95 });
          } else if (isFrontWin) {
            pushFramedWindow(x, y, z, 0, 1, gy === 2 || gy === 4);
          } else if (isBackWin) {
            pushFramedWindow(x, y, z, 0, -1, gy === 4);
          } else if (isSideWin) {
            pushFramedWindow(x, y, z, -1, 0, gy === 4);
          } else if (isCorner || isUpperTimber) {
            timberSpecs.push({ x, y, z });
          } else {
            pushStone(x, y, z);
          }
        }
      }
    }
    // Arched stone door frame, recessed plank door leaf, and hanging warm porch lantern
    pushStone(1.06, 2.02, 0.25, 0.35, 0.36, 1.35);
    scaffSpecs.push({ x: 0.92, y: 1.32, z: 0.25, sx: 0.16, sy: 1.42, sz: 0.78 });
    timberSpecs.push(
      { x: 1.08, y: 1.32, z: -0.16, sx: 0.16, sy: 1.55, sz: 0.14 },
      { x: 1.08, y: 1.32, z: 0.66, sx: 0.16, sy: 1.55, sz: 0.14 },
      { x: 1.08, y: 2.02, z: 0.25, sx: 0.16, sy: 0.14, sz: 0.98 },
      { x: 1.38, y: 1.72, z: 0.92, sx: 0.42, sy: 0.1, sz: 0.1 },
      { x: 1.52, y: 1.56, z: 0.92, sx: 0.08, sy: 0.28, sz: 0.08 },
    );
    lanternSpecs.push({ x: 1.52, y: 1.34, z: 0.92, sx: 0.24, sy: 0.28, sz: 0.24 });
    timberSpecs.push(
      { x: -0.75, y: 2.15, z: 1.12, sx: 3.4, sy: 0.14, sz: 0.18 },
      { x: -0.75, y: 2.85, z: 1.12, sx: 3.4, sy: 0.14, sz: 0.18 },
      { x: -1.7, y: 2.5, z: 1.12, sx: 0.14, sy: 0.9, sz: 0.16 },
      { x: 0.25, y: 2.5, z: 1.12, sx: 0.14, sy: 0.9, sz: 0.16 },
    );

    // 5-Tier Stepped Slate Pitched Roof (symmetric around gx = -1.5) + Stone Gable Wall + Arched Purple Gable Window
    for (let tier = 0; tier < 5; tier++) {
      const y = 3.9 + tier * 0.44;
      const minGx = -6 + tier;
      const maxGx = 3 - tier;
      for (let gz = -5; gz <= 3; gz++) {
        const z = gz * u;
        for (let gx = minGx; gx <= maxGx; gx++) {
          const x = gx * u;
          const isSlopeEdge = gx === minGx || gx === maxGx || tier === 4;
          const isGableFace = gz === 3 || gz === -5;
          const isGableWin = isGableFace && !isSlopeEdge && (tier === 1 || tier === 2) && (gx === -2 || gx === -1);
          if (isGableWin) {
            pushFramedWindow(x, y, z - (gz === 3 ? 0.14 : -0.14), 0, gz === 3 ? 1 : -1, tier === 1);
          } else if (isGableFace && !isSlopeEdge) {
            pushStone(x, y, z - (gz === 3 ? 0.14 : -0.14));
          } else {
            pushRoof(x, y, z, 1.02, 0.92, 1.02);
          }
        }
      }
      // Wooden bargeboard eaves tucked cleanly under the pitched roof edges (skip ridge)
      if (tier < 4) {
        timberSpecs.push(
          { x: minGx * u, y: y - 0.16, z: 1.62, sx: 0.72, sy: 0.42, sz: 0.42 },
          { x: maxGx * u, y: y - 0.16, z: 1.62, sx: 0.72, sy: 0.42, sz: 0.42 },
        );
      }
    }
    // Right-side roof dormer, crane pulley & left-back stone chimney with rising smoke puffs
    pushStone(-1.45, 5.35, -1.2, 0.55, 1.15, 0.55);
    stoneLightSpecs.push({ x: -1.45, y: 5.85, z: -1.2, sx: 0.72, sy: 0.16, sz: 0.72 });
    // House-high hoist: two full ladders, thick posts, four platforms, barrels, and a beam.
    const ladder = (x: number, z: number) => {
      timberSpecs.push(
        { x: x - 0.28, y: 2.55, z, sx: 0.38, sy: 11.2, sz: 0.38 },
        { x: x + 0.28, y: 2.55, z, sx: 0.38, sy: 11.2, sz: 0.38 },
      );
      for (let r = 0; r < 11; r++) {
        timberSpecs.push({ x, y: 0.35 + r * 0.46, z, sx: 1.55, sy: 0.18, sz: 0.2 });
      }
    };
    ladder(2.55, 1.05);
    ladder(3.95, 1.05);
    timberSpecs.push(
      { x: 2.55, y: 2.55, z: -0.15, sx: 0.42, sy: 11.2, sz: 0.42 },
      { x: 3.95, y: 2.55, z: -0.15, sx: 0.42, sy: 11.2, sz: 0.42 },
      { x: 3.25, y: 1.25, z: 0.45, sx: 5.4, sy: 0.38, sz: 3.6 },
    );
    // Multi-tier right scaffolding platforms, cross-rails, barrels, crane arm & pulley block
    scaffSpecs.push(
      { x: 3.25, y: 2.45, z: 0.45, sx: 5.4, sy: 0.38, sz: 3.6 },
      { x: 3.25, y: 3.65, z: 0.45, sx: 5.4, sy: 0.38, sz: 3.6 },
      { x: 3.25, y: 4.75, z: 0.45, sx: 5.4, sy: 0.42, sz: 3.6 },
      // Safety guardrails & ladder rungs on front face
      { x: 3.25, y: 5.15, z: 1.35, sx: 5.2, sy: 0.16, sz: 0.16 },
      { x: 3.25, y: 4.05, z: 1.35, sx: 5.2, sy: 0.16, sz: 0.16 },
      { x: 3.25, y: 2.85, z: 1.35, sx: 5.2, sy: 0.16, sz: 0.16 },
      // Barrels & supply crates on scaffolding platforms
      { x: 2.7, y: 1.62, z: 0.35, sx: 1.15, sy: 1.15, sz: 1.15 },
      { x: 3.75, y: 1.58, z: 0.7, sx: 1.05, sy: 1.05, sz: 1.05 },
      { x: 3.15, y: 2.82, z: 0.25, sx: 1.15, sy: 1.15, sz: 1.15 },
      { x: 3.7, y: 4.05, z: 0.3, sx: 1.1, sy: 1.1, sz: 1.1 },
      { x: 2.65, y: 5.15, z: 0.2, sx: 1.15, sy: 1.35, sz: 1.15 },
      { x: 3.9, y: 5.15, z: 0.1, sx: 1.05, sy: 1.25, sz: 1.05 },
      // Crane boom + suspended pulley hook
      { x: 3.25, y: 5.55, z: 0.45, sx: 0.38, sy: 1.6, sz: 0.38 },
      { x: 3.25, y: 6.15, z: 1.65, sx: 0.38, sy: 0.38, sz: 5.4 },
      { x: 3.25, y: 4.55, z: 2.65, sx: 0.18, sy: 3.2, sz: 0.18 },
      { x: 3.25, y: 3.45, z: 2.65, sx: 0.92, sy: 0.82, sz: 0.92 },
      // Ground-level barrels & crates beside the scaffolding
      { x: 2.45, y: 0.38, z: 1.85, sx: 1.2, sy: 1.25, sz: 1.2 },
      { x: 3.35, y: 0.34, z: 1.95, sx: 1.1, sy: 1.15, sz: 1.1 },
      { x: 4.15, y: 0.3, z: 1.7, sx: 1.05, sy: 1.0, sz: 1.05 },
    );
    for (let r = 0; r < 6; r++) {
      timberSpecs.push({ x: 2.15, y: 0.55 + r * 0.72, z: 1.35, sx: 0.85, sy: 0.14, sz: 0.14 });
    }

    // 7. Fine-Detail Clustered Sub-Voxel Pine Trees, Shrubs, Cobblestones & Flowers
    const trunkSpecs: VoxelSpec[] = [
      { x: -4.3, y: 0.8, z: 0.15, sx: 0.42, sy: 2.1, sz: 0.42 },
      { x: -3.7, y: 0.7, z: 1.7, sx: 0.38, sy: 1.8, sz: 0.38 },
      { x: -4.7, y: 0.65, z: 2.5, sx: 0.36, sy: 1.6, sz: 0.36 },
      { x: 5.55, y: 0.7, z: 1.7, sx: 0.38, sy: 1.8, sz: 0.38 },
      { x: 5.9, y: 0.62, z: -0.2, sx: 0.34, sy: 1.5, sz: 0.34 },
    ];
    // Table in front of the crane, bench to the left of the path.
    scaffSpecs.push(
      { x: 1.75, y: 0.62, z: 3.05, sx: 1.35, sy: 0.12, sz: 0.85 },
      { x: 1.25, y: 0.32, z: 2.78, sx: 0.12, sy: 0.48, sz: 0.12 },
      { x: 2.25, y: 0.32, z: 2.78, sx: 0.12, sy: 0.48, sz: 0.12 },
      { x: 1.25, y: 0.32, z: 3.32, sx: 0.12, sy: 0.48, sz: 0.12 },
      { x: 2.25, y: 0.32, z: 3.32, sx: 0.12, sy: 0.48, sz: 0.12 },
      { x: 1.5, y: 0.76, z: 2.95, sx: 0.28, sy: 0.14, sz: 0.22 },
      { x: -1.85, y: 0.4, z: 2.95, sx: 1.2, sy: 0.12, sz: 0.42 },
      { x: -2.3, y: 0.22, z: 2.95, sx: 0.12, sy: 0.28, sz: 0.34 },
      { x: -1.4, y: 0.22, z: 2.95, sx: 0.12, sy: 0.28, sz: 0.34 },
      { x: -1.85, y: 0.62, z: 2.78, sx: 1.2, sy: 0.32, sz: 0.1 },
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
    addFineTree(-4.3, 1.45, 0.15, 4);
    addFineTree(-3.7, 1.3, 1.7, 3);
    addFineTree(-4.7, 1.2, 2.5, 3);
    addFineTree(5.55, 1.3, 1.7, 3);
    addFineTree(5.9, 1.15, -0.2, 3);

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
      [-2.55, 2.15],
      [0.55, 2.35],
      [-3.3, 3.1],
      [2.7, 2.15],
      [-1.4, 4.4],
      [1.8, 4.5],
      [-4.1, 4.0],
      [3.8, 3.9],
    ] as const) {
      addBush(sx, sz, 0.85);
    }
    for (const [cx, cz] of [
      [-0.75, 1.7],
      [-0.75, 2.15],
      [-0.75, 2.6],
      [-0.75, 3.05],
      [-0.65, 3.65],
      [-0.15, 4.05],
      [0.55, 3.85],
      [1.25, 3.35],
      [1.38, 2.8],
      [-1.45, 3.85],
      [-2.15, 3.7],
    ] as const) {
      stoneLightSpecs.push({ x: cx, y: 0.16, z: cz, sx: 0.62, sy: 0.14, sz: 0.48 });
    }
    // Left-foreground stone wishing well + wooden canopy
    stoneMidSpecs.push({ x: -3.25, y: 0.36, z: 3.65, sx: 1.35, sy: 0.72, sz: 1.35 });
    timberSpecs.push(
      { x: -3.55, y: 0.92, z: 3.65, sx: 0.14, sy: 1.05, sz: 0.14 },
      { x: -2.95, y: 0.92, z: 3.65, sx: 0.14, sy: 1.05, sz: 0.14 },
    );
    roofDarkSpecs.push({ x: -3.25, y: 1.38, z: 3.65, sx: 1.6, sy: 0.36, sz: 1.3 });
    scaffSpecs.push(
      { x: -2.35, y: 0.2, z: 2.25, sx: 1.35, sy: 0.16, sz: 0.6 },
      { x: 0.55, y: 0.2, z: 2.4, sx: 1.2, sy: 0.16, sz: 0.55 },
    );

    const blossomPinkMat = new THREE.MeshStandardMaterial({ color: 0xe672a5, roughness: 0.62 });
    const blossomGoldMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.58 });
    const blossomWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f1ea, roughness: 0.6 });
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xf3eee8,
      roughness: 0.95,
      transparent: true,
      opacity: 0.7,
    });

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

    islandGroup.add(buildVoxelInstances(voxelGeo, grassMat, grassSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, mossMat, mossSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, dirtMat, dirtSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, stoneLightMat, stoneLightSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, stoneMidMat, stoneMidSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, stoneDarkMat, stoneDarkSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, darkWoodMat, [...timberSpecs, ...trunkSpecs]));
    islandGroup.add(buildVoxelInstances(voxelGeo, woodMat, scaffSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, roofMat, roofDarkSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, roofLightMat, roofLightSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, pineMat, pineSpecs));
    islandGroup.add(
      buildVoxelInstances(voxelGeo, blossomPinkMat, [
        { x: -2.6, y: 0.38, z: 2.15, sx: 0.22, sy: 0.2, sz: 0.22 },
        { x: -2.15, y: 0.4, z: 2.35, sx: 0.2, sy: 0.18, sz: 0.2 },
        { x: 0.35, y: 0.38, z: 2.3, sx: 0.2, sy: 0.18, sz: 0.2 },
        { x: -1.85, y: 1.15, z: 1.22, sx: 0.14, sy: 0.14, sz: 0.14 },
      ]),
    );
    islandGroup.add(
      buildVoxelInstances(voxelGeo, blossomGoldMat, [
        { x: -2.4, y: 0.4, z: 2.05, sx: 0.18, sy: 0.16, sz: 0.18 },
        { x: 0.7, y: 0.4, z: 2.5, sx: 0.18, sy: 0.16, sz: 0.18 },
        { x: 0.5, y: 0.38, z: 2.15, sx: 0.16, sy: 0.16, sz: 0.16 },
      ]),
    );
    islandGroup.add(
      buildVoxelInstances(voxelGeo, blossomWhiteMat, [
        { x: -2.5, y: 0.4, z: 2.28, sx: 0.16, sy: 0.16, sz: 0.16 },
        { x: 0.55, y: 0.4, z: 2.42, sx: 0.16, sy: 0.16, sz: 0.16 },
      ]),
    );
    islandGroup.add(
      buildVoxelInstances(
        voxelGeo,
        smokeMat,
        [
          { x: -1.4, y: 6.15, z: -1.15, sx: 0.42, sy: 0.36, sz: 0.42 },
          { x: -1.25, y: 6.55, z: -1.0, sx: 0.55, sy: 0.4, sz: 0.55 },
          { x: -1.05, y: 6.95, z: -0.8, sx: 0.68, sy: 0.42, sz: 0.68 },
        ],
        false,
        false,
      ),
    );
    lanternSpecs.push({ x: 1.5, y: 0.9, z: 2.95, sx: 0.12, sy: 0.16, sz: 0.12 });
    islandGroup.add(buildVoxelInstances(voxelGeo, crystalMat, windowSpecs, false, false));
    islandGroup.add(buildVoxelInstances(voxelGeo, lanternMat, lanternSpecs, false, false));

    // 8. Villagers on the garden path. Clicking one makes that person hop.
    type LimbActor = {
      group: THREE.Group;
      base: THREE.Vector3;
      phase: number;
      hopUntil: number;
      leftLeg: THREE.Object3D;
      rightLeg: THREE.Object3D;
      leftArm: THREE.Object3D;
      rightArm: THREE.Object3D;
    };
    const villagers: LimbActor[] = [];
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6cba8, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2820, roughness: 0.84 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.86 });
    const addVillager = (x: number, y: number, z: number, shirt: number, hat: number, rotY: number, phase: number) => {
      const g = new THREE.Group();
      const cloth = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.66 });
      const hatMat = new THREE.MeshStandardMaterial({ color: hat, roughness: 0.7 });
      const head = new THREE.Mesh(voxelGeo, skinMat);
      head.scale.set(0.62, 0.58, 0.58);
      head.position.y = 1.18;
      const hair = new THREE.Mesh(voxelGeo, hairMat);
      hair.scale.set(0.66, 0.22, 0.62);
      hair.position.y = 1.38;
      const cap = new THREE.Mesh(voxelGeo, hatMat);
      cap.scale.set(0.78, 0.16, 0.78);
      cap.position.y = 1.48;
      const body = new THREE.Mesh(voxelGeo, cloth);
      body.scale.set(0.72, 0.62, 0.42);
      body.position.y = 0.78;
      const leftLeg = new THREE.Mesh(voxelGeo, legMat);
      leftLeg.scale.set(0.24, 0.46, 0.26);
      leftLeg.position.set(-0.14, 0.28, 0);
      const rightLeg = new THREE.Mesh(voxelGeo, legMat);
      rightLeg.scale.set(0.24, 0.46, 0.26);
      rightLeg.position.set(0.14, 0.28, 0);
      const leftArm = new THREE.Mesh(voxelGeo, cloth);
      leftArm.scale.set(0.18, 0.46, 0.2);
      leftArm.position.set(-0.42, 0.78, 0);
      const rightArm = new THREE.Mesh(voxelGeo, cloth);
      rightArm.scale.set(0.18, 0.46, 0.2);
      rightArm.position.set(0.42, 0.78, 0);
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.45 });
      const eyeL = new THREE.Mesh(voxelGeo, eyeMat);
      eyeL.scale.set(0.1, 0.1, 0.08);
      eyeL.position.set(-0.14, 1.2, 0.28);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.14;
      const shoeL = new THREE.Mesh(voxelGeo, legMat);
      shoeL.scale.set(0.28, 0.1, 0.34);
      shoeL.position.set(-0.14, 0.08, 0.04);
      const shoeR = shoeL.clone();
      shoeR.position.x = 0.14;
      g.add(head, hair, cap, body, leftLeg, rightLeg, leftArm, rightArm, eyeL, eyeR, shoeL, shoeR);
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      g.scale.setScalar(1.22);
      islandGroup.add(g);
      villagers.push({
        group: g,
        base: new THREE.Vector3(x, y, z),
        phase,
        hopUntil: 0,
        leftLeg,
        rightLeg,
        leftArm,
        rightArm,
      });
    };
    addVillager(-0.45, 0.08, 3.65, 0xc47a4a, 0x6b3e22, 0.25, 0.2);
    addVillager(2.85, 0.08, 3.35, 0x4e9a52, 0x8d8276, -0.55, 1.4);
    addVillager(-2.45, 0.08, 2.75, 0xd9d0c4, 0x5a4032, 0.65, 2.6);
    addVillager(4.45, 0.08, 1.55, 0xc4894a, 0xf5b942, -1.25, 3.8);

    // Upgrade villagers with the 1:1 Aria Voxel Engineer GLB model (with articulated joints & tools)
    const toolRoles: Array<"hammer" | "wrench" | "tablet" | "hammer"> = ["hammer", "wrench", "tablet", "hammer"];
    let disposed = false;
    new GLTFLoader().load(
      "/models/aria-engineer.glb",
      (gltf) => {
        if (disposed) return;
        villagers.forEach((v, idx) => {
          const clone = gltf.scene.clone(true);
          clone.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          const role = toolRoles[idx % toolRoles.length];
          const hammer = clone.getObjectByName("ToolHammer");
          const wrench = clone.getObjectByName("ToolWrench");
          const tablet = clone.getObjectByName("ToolTablet");
          if (hammer) hammer.visible = role === "hammer";
          if (wrench) wrench.visible = role === "wrench";
          if (tablet) tablet.visible = role === "tablet";

          v.group.clear();
          v.group.add(clone);
          v.group.scale.setScalar(0.95);
          v.leftLeg = clone.getObjectByName("LegL") ?? v.leftLeg;
          v.rightLeg = clone.getObjectByName("LegR") ?? v.rightLeg;
          v.leftArm = clone.getObjectByName("ArmL") ?? v.leftArm;
          v.rightArm = clone.getObjectByName("ArmR") ?? v.rightArm;
        });
      },
      undefined,
      () => {
        // Keep procedural fallback if GLB fails to load
      },
    );

    // 8b. Round Milestone Memorial Obelisks (1 unlocked per completed round, up to 5)
    const milestoneTowers: { group: THREE.Group; baseY: number; idx: number }[] = [];
    for (const [idx, [mx, my, mz]] of (
      [
        [-3.6, 0.35, 3.8],
        [3.6, 0.35, 3.6],
        [-4.8, 0.35, 0.2],
        [4.8, 0.35, -3.9],
        [-3.9, 0.35, -4.1],
      ] as const
    ).entries()) {
      const mg = new THREE.Group();
      const base = new THREE.Mesh(voxelGeo, stoneLightMat);
      base.scale.set(0.9, 0.45, 0.9);
      const pillar = new THREE.Mesh(voxelGeo, crystalMat);
      pillar.scale.set(0.45, 1.15, 0.45);
      pillar.position.y = 0.45;
      const cap = new THREE.Mesh(voxelGeo, lanternMat);
      cap.scale.set(0.32, 0.32, 0.32);
      cap.position.y = 0.88;
      mg.add(base, pillar, cap);
      mg.position.set(mx, my, mz);
      mg.visible = false;
      islandGroup.add(mg);
      milestoneTowers.push({ group: mg, baseY: my, idx });
    }

    // 8c. Active-Build Blueprint Construction Block (visible during executing/planning)
    const blueprintMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.3,
      transparent: true,
      opacity: 0.72,
      roughness: 0.2,
    });
    const blueprintCube = new THREE.Mesh(voxelGeo, blueprintMat);
    blueprintCube.scale.set(1.3, 1.3, 1.3);
    blueprintCube.position.set(4.55, 6.2, -2.3);
    blueprintCube.visible = false;
    islandGroup.add(blueprintCube);

    // Fox on the lawn, a hen by the flower beds, and a bird on the roof.
    const furMat = new THREE.MeshStandardMaterial({ color: 0xe8893a, roughness: 0.62 });
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xfff4e4, roughness: 0.58 });
    const fox = new THREE.Group();
    const foxBody = new THREE.Mesh(voxelGeo, furMat);
    foxBody.scale.set(0.78, 0.42, 1.05);
    foxBody.position.y = 0.32;
    const foxChest = new THREE.Mesh(voxelGeo, creamMat);
    foxChest.scale.set(0.4, 0.28, 0.36);
    foxChest.position.set(0, 0.28, 0.28);
    const foxHead = new THREE.Mesh(voxelGeo, furMat);
    foxHead.scale.set(0.48, 0.42, 0.48);
    foxHead.position.set(0, 0.52, 0.52);
    const foxEarL = new THREE.Mesh(voxelGeo, furMat);
    foxEarL.scale.set(0.14, 0.28, 0.14);
    foxEarL.position.set(-0.14, 0.74, 0.5);
    const foxEarR = foxEarL.clone();
    foxEarR.position.x = 0.14;
    const foxTail = new THREE.Mesh(voxelGeo, furMat);
    foxTail.scale.set(0.22, 0.22, 0.62);
    foxTail.position.set(0, 0.42, -0.62);
    const foxTip = new THREE.Mesh(voxelGeo, creamMat);
    foxTip.scale.set(0.18, 0.18, 0.22);
    foxTip.position.set(0, 0.48, -0.88);
    const foxLeg = (lx: number, lz: number) => {
      const leg = new THREE.Mesh(voxelGeo, furMat);
      leg.scale.set(0.14, 0.28, 0.16);
      leg.position.set(lx, 0.12, lz);
      return leg;
    };
    fox.add(foxBody, foxChest, foxHead, foxEarL, foxEarR, foxTail, foxTip, foxLeg(-0.22, 0.28), foxLeg(0.22, 0.28), foxLeg(-0.22, -0.22), foxLeg(0.22, -0.22));
    const foxBase = new THREE.Vector3(-3.15, 0.08, 2.7);
    fox.position.copy(foxBase);
    fox.scale.setScalar(1.15);
    islandGroup.add(fox);
    let foxHopUntil = 0;

    const hen = new THREE.Group();
    const henBody = new THREE.Mesh(voxelGeo, creamMat);
    henBody.scale.set(0.55, 0.4, 0.7);
    henBody.position.y = 0.28;
    const henHead = new THREE.Mesh(voxelGeo, creamMat);
    henHead.scale.set(0.32, 0.3, 0.32);
    henHead.position.set(0, 0.52, 0.28);
    const combMat = new THREE.MeshStandardMaterial({ color: 0xd4534a, roughness: 0.6 });
    const comb = new THREE.Mesh(voxelGeo, combMat);
    comb.scale.set(0.16, 0.16, 0.22);
    comb.position.set(0, 0.68, 0.28);
    const beak = new THREE.Mesh(voxelGeo, new THREE.MeshStandardMaterial({ color: 0xf5b942, roughness: 0.5 }));
    beak.scale.set(0.12, 0.1, 0.16);
    beak.position.set(0, 0.48, 0.46);
    hen.add(henBody, henHead, comb, beak);
    const henBase = new THREE.Vector3(0.15, 0.08, 2.85);
    hen.scale.setScalar(1.25);
    hen.position.copy(henBase);
    islandGroup.add(hen);
    let henHopUntil = 0;

    const bird = new THREE.Group();
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x6e8fbf, roughness: 0.55 });
    const birdBody = new THREE.Mesh(voxelGeo, birdMat);
    birdBody.scale.set(0.28, 0.22, 0.42);
    const wingL = new THREE.Mesh(voxelGeo, birdMat);
    wingL.scale.set(0.34, 0.08, 0.22);
    wingL.position.set(-0.22, 0.04, 0);
    const wingR = wingL.clone();
    wingR.position.x = 0.22;
    bird.add(birdBody, wingL, wingR);
    const birdBase = new THREE.Vector3(0.85, 4.55, 1.15);
    bird.scale.setScalar(1.7);
    bird.position.copy(birdBase);
    islandGroup.add(bird);
    let birdFlyUntil = 0;

    // 9. Cohesive Stepped 3D Voxel Cloud Clusters + Distant Upper-Left Mini-Island
    const bgIslands = new THREE.Group();
    const cloudLightMat = new THREE.MeshStandardMaterial({
      color: 0xf7ece8,
      roughness: 0.72,
      transparent: true,
      opacity: 0.92,
    });
    const cloudShadeMat = new THREE.MeshStandardMaterial({
      color: 0xbba8d4,
      roughness: 0.78,
      transparent: true,
      opacity: 0.86,
    });
    const cloudTopSpecs: VoxelSpec[] = [];
    const cloudBotSpecs: VoxelSpec[] = [];
    const addVoxelCloud = (cx: number, cy: number, cz: number, scale = 1) => {
      const puffs = [
        [0, 0.22, 0, 3.0, 1.25, 2.2],
        [-0.85, 0.1, 0.15, 2.3, 1.05, 1.8],
        [0.9, 0.08, -0.1, 2.3, 1.05, 1.8],
        [-0.35, 0.52, -0.05, 2.0, 1.0, 1.6],
        [0.4, 0.46, 0.1, 1.85, 0.95, 1.5],
        [0.0, 0.72, 0.0, 1.25, 0.78, 1.15],
      ] as const;
      for (const [dx, dy, dz, sx, sy, sz] of puffs) {
        cloudTopSpecs.push({
          x: cx + dx * scale,
          y: cy + dy * scale,
          z: cz + dz * scale,
          sx: sx * scale,
          sy: sy * scale,
          sz: sz * scale,
        });
        cloudBotSpecs.push({
          x: cx + dx * scale,
          y: cy + (dy - 0.26) * scale,
          z: cz + dz * scale,
          sx: sx * 0.98 * scale,
          sy: sy * 0.58 * scale,
          sz: sz * 0.98 * scale,
        });
      }
    };
    addVoxelCloud(-9.8, 2.2, 0.8, 1.2);
    addVoxelCloud(9.8, 3.1, -3.6, 1.25);
    addVoxelCloud(-8.8, -4.8, 5.2, 1.35);
    addVoxelCloud(8.6, -4.5, 4.8, 1.3);
    addVoxelCloud(-3.6, 6.8, -9.2, 0.95);
    addVoxelCloud(5.2, -6.4, 8.6, 1.05);
    bgIslands.add(buildVoxelInstances(voxelGeo, cloudShadeMat, cloudBotSpecs, false, false));
    bgIslands.add(buildVoxelInstances(voxelGeo, cloudLightMat, cloudTopSpecs, false, false));

    // Distant upper-left atmospheric mini floating island (offset far left-back so it never blocks roof)
    const farGrassMat = new THREE.MeshStandardMaterial({ color: 0x3e5e56, roughness: 0.92 });
    const farStoneMat = new THREE.MeshStandardMaterial({ color: 0x352c4b, roughness: 0.94 });
    const farPineMat = new THREE.MeshStandardMaterial({ color: 0x2c4742, roughness: 0.92 });
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farGrassMat,
        [{ x: -16.5, y: 5.8, z: -12.0, sx: 5.5, sy: 0.9, sz: 5.2 }],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farStoneMat,
        [
          { x: -16.5, y: 4.9, z: -12.0, sx: 4.6, sy: 2.2, sz: 4.4 },
          { x: -16.5, y: 3.5, z: -12.0, sx: 2.8, sy: 2.0, sz: 2.8 },
          { x: -16.0, y: 6.7, z: -11.8, sx: 1.8, sy: 1.8, sz: 1.8 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farPineMat,
        [
          { x: -17.8, y: 6.8, z: -12.1, sx: 1.3, sy: 2.2, sz: 1.3 },
          { x: -15.1, y: 6.6, z: -12.7, sx: 1.1, sy: 1.8, sz: 1.1 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        lanternMat,
        [{ x: -15.9, y: 6.6, z: -11.2, sx: 0.45, sy: 0.45, sz: 0.45 }],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farStoneMat,
        [
          { x: 12.4, y: -3.4, z: 9.2, sx: 3.2, sy: 1.4, sz: 2.6 },
          { x: 12.4, y: -4.2, z: 9.2, sx: 2.1, sy: 1.2, sz: 1.8 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farGrassMat,
        [{ x: 12.4, y: -2.7, z: 9.2, sx: 2.8, sy: 0.55, sz: 2.2 }],
        false,
        false,
      ),
    );
    scene.add(bgIslands);

    // Dual-color floating violet + warm gold fireflies + dense under-island violet glow motes
    const makeMotes = (color: number, count: number, minY = -2.5, maxY = 6.5, size = 0.16) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 16;
        pos[i * 3 + 1] = minY + Math.random() * (maxY - minY);
        pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.88 }));
    };
    scene.add(makeMotes(0xffe7c2, 28, 1.2, 6.2, 0.12));
    // Warm low-altitude porch & staircase fireflies
    const porchMotePos = new Float32Array(18 * 3);
    for (let i = 0; i < 18; i++) {
      porchMotePos[i * 3] = (Math.random() - 0.5) * 5.2;
      porchMotePos[i * 3 + 1] = 0.4 + Math.random() * 1.6;
      porchMotePos[i * 3 + 2] = 1.6 + Math.random() * 3.2;
    }
    const porchMoteGeo = new THREE.BufferGeometry();
    porchMoteGeo.setAttribute("position", new THREE.BufferAttribute(porchMotePos, 3));
    scene.add(new THREE.Points(porchMoteGeo, new THREE.PointsMaterial({ color: 0xffd280, size: 0.14, transparent: true, opacity: 0.9 })));

    const bursts: BurstCube[] = [];
    const burstGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const burstMats = new Map<number, THREE.MeshStandardMaterial>();
    const spark = (colorHex: number, origin: { x: number; y: number; z: number }, count = 10) => {
      let mat = burstMats.get(colorHex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.85, roughness: 0.4 });
        burstMats.set(colorHex, mat);
      }
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(burstGeo, mat);
        mesh.position.set(origin.x, origin.y, origin.z);
        scene.add(mesh);
        const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const spd = 0.03 + Math.random() * 0.045;
        bursts.push({
          mesh,
          vx: Math.cos(ang) * spd,
          vy: 0.04 + Math.random() * 0.05,
          vz: Math.sin(ang) * spd,
          life: 28,
        });
      }
    };
    burstFnRef.current = (colorHex, origin = { x: -0.75, y: 1.6, z: 2.1 }) => spark(colorHex, origin, 12);

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    const isChildOf = (obj: THREE.Object3D, root: THREE.Object3D) => {
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (cur === root) return true;
        cur = cur.parent;
      }
      return false;
    };
    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects([fox, hen, bird, ...villagers.map((v) => v.group)], true);
      renderer.domElement.style.cursor = hits.length > 0 ? "pointer" : "grab";
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(islandGroup.children, true);
      const hit = hits[0];
      if (!hit) return;
      const nowMs = performance.now();
      const at = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
      const person = villagers.find((v) => isChildOf(hit.object, v.group));
      if (person) {
        person.hopUntil = nowMs + 720;
        spark(0xffb44c, at, 8);
        return;
      }
      if (isChildOf(hit.object, fox)) {
        foxHopUntil = nowMs + 860;
        spark(0xe8893a, at, 10);
        return;
      }
      if (isChildOf(hit.object, hen)) {
        henHopUntil = nowMs + 640;
        spark(0xfff4e4, at, 8);
        return;
      }
      if (isChildOf(hit.object, bird)) {
        birdFlyUntil = nowMs + 1400;
        spark(0xd7e4f5, at, 8);
        return;
      }
      spark(0xffe49e, at, 12);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const w = Math.max(320, container.clientWidth);
            const h = Math.max(180, container.clientHeight);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
          })
        : null;
    ro?.observe(container);

    let raf = 0;
    let frame = 0;
    let seenPhase = stateRef.current.round?.phase ?? "idle";
    let seenCelebration = stateRef.current.celebrations?.at(-1)?.id ?? null;
    const targetFlag = new THREE.Color();

    const animate = () => {
      frame += 1;
      const t = frame * 0.016;
      const nowMs = performance.now();

      const pal = resolveThemePalette(stateRef.current.round?.prompt, stateRef.current.round?.modifiers);
      targetFlag.setHex(pal.crystal);
      crystalMat.emissive.lerp(targetFlag, 0.05);

      const phase = stateRef.current.round?.phase ?? "idle";
      if (phase !== seenPhase) {
        seenPhase = phase;
        spark(0xffb44c, { x: -0.75, y: 1.7, z: 2.2 }, 14);
        for (const v of villagers) v.hopUntil = nowMs + 520;
      }
      const celebration = stateRef.current.celebrations?.at(-1);
      if (celebration && celebration.id !== seenCelebration) {
        seenCelebration = celebration.id;
        foxHopUntil = nowMs + 1100;
        birdFlyUntil = nowMs + 1400;
        spark(0xf5b942, { x: fox.position.x, y: 1.1, z: fox.position.z }, 16);
      }

      for (const v of villagers) {
        const hopping = nowMs < v.hopUntil;
        const hop = hopping ? Math.sin(((v.hopUntil - nowMs) / 720) * Math.PI) * 0.42 : 0;
        const step = Math.sin(t * 2.4 + v.phase);
        v.group.position.x = v.base.x + Math.sin(t * 0.32 + v.phase) * 0.28;
        v.group.position.z = v.base.z + Math.cos(t * 0.26 + v.phase) * 0.18;
        v.group.position.y = v.base.y + hop;
        v.leftLeg.rotation.x = hopping ? -0.5 : step * 0.45;
        v.rightLeg.rotation.x = hopping ? 0.5 : -step * 0.45;
        const phase = stateRef.current.round?.phase ?? "idle";
        if (phase === "done") {
          v.group.position.y = v.base.y + Math.abs(Math.sin(t * 5 + v.phase)) * 0.34;
          v.leftArm.rotation.x = -2.35;
          v.rightArm.rotation.x = -2.35;
        } else if (phase === "executing") {
          v.leftArm.rotation.x = step * 0.25;
          v.rightArm.rotation.x = -0.85 - Math.abs(Math.sin(t * 7 + v.phase)) * 0.95;
        } else {
          v.leftArm.rotation.x = hopping ? -0.8 : step * 0.3;
          v.rightArm.rotation.x = hopping ? -0.8 : -step * 0.3;
        }
      }

      const foxWalk = Math.sin(t * 0.45);
      fox.position.x = foxBase.x + foxWalk * 1.15;
      fox.position.z = foxBase.z + Math.cos(t * 0.45) * 0.55;
      fox.rotation.y = Math.atan2(Math.cos(t * 0.45) * 1.15, -Math.sin(t * 0.45) * 0.55);
      fox.position.y = foxBase.y + (nowMs < foxHopUntil ? Math.sin(((foxHopUntil - nowMs) / 860) * Math.PI) * 0.38 : 0);
      foxTail.rotation.y = Math.sin(t * 5) * 0.45;

      hen.position.x = henBase.x + Math.sin(t * 0.7) * 0.35;
      hen.position.z = henBase.z + Math.cos(t * 0.55) * 0.2;
      hen.position.y = henBase.y + (nowMs < henHopUntil ? Math.sin(((henHopUntil - nowMs) / 640) * Math.PI) * 0.28 : 0);
      henHead.rotation.x = Math.sin(t * 3.2) > 0.65 ? 0.45 : 0;

      if (nowMs < birdFlyUntil) {
        const k = 1 - (birdFlyUntil - nowMs) / 1400;
        bird.position.x = birdBase.x + Math.sin(k * Math.PI * 2) * 1.1;
        bird.position.z = birdBase.z + Math.cos(k * Math.PI * 2) * 0.6;
        bird.position.y = birdBase.y + Math.sin(k * Math.PI) * 1.5;
        wingL.rotation.z = Math.sin(t * 18) * 0.7;
        wingR.rotation.z = -Math.sin(t * 18) * 0.7;
      } else {
        bird.position.copy(birdBase);
        wingL.rotation.z = Math.sin(t * 4) * 0.15;
        wingR.rotation.z = -Math.sin(t * 4) * 0.15;
      }

      for (const m of milestoneTowers) m.group.visible = false;
      blueprintCube.visible = false;
      islandGroup.position.y = 0;
      porchLight.intensity = 1.55 + Math.sin(t * 2.2) * 0.08;

      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]!;
        b.mesh.position.x += b.vx;
        b.mesh.position.y += b.vy;
        b.mesh.position.z += b.vz;
        b.vy -= 0.004;
        if (b.mesh.position.y < 0.35 && b.vy < 0) {
          b.mesh.position.y = 0.35;
          b.vy = -b.vy * 0.45;
          b.vx *= 0.82;
          b.vz *= 0.82;
        }
        b.mesh.rotation.x += 0.1;
        b.mesh.rotation.y += 0.12;
        b.life -= 1;
        b.mesh.scale.setScalar(Math.max(0.01, b.life / 28));
        if (b.life <= 0) {
          scene.remove(b.mesh);
          bursts.splice(i, 1);
        }
      }

      controls.update();
      const eco = ecoModeRef.current;
      if (renderer.shadowMap.enabled !== !eco) {
        renderer.shadowMap.enabled = !eco;
        renderer.shadowMap.needsUpdate = true;
      }
      renderer.render(scene, camera);

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      burstFnRef.current = null;
    };
  }, []);

  const ideas = (state.round?.ideas.filter((i) => !i.hidden) ?? []).slice(-4);

  return (
    <div className="workshop-scene workshop-scene--3d" ref={mountRef}>
      {!webglReady && <img className="workshop-scene__art" src="/art/voxel-workshop.jpg" alt="Voxel Workshop Stage" />}

      {ideas.map((idea, idx) => (
        <div
          key={idea.id}
          className={`workshop-bubble workshop-bubble--flank workshop-bubble--flank-${idx} ${idea.boosts ? "is-boosted" : ""}`}
        >
          <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
          <span className="workshop-bubble__text">{truncate(idea.text, 22)}</span>
          {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
        </div>
      ))}

      {(state.coBuilders ?? []).slice(0, 3).map((b, idx) => (
        <div key={b.login} className="workshop-builder-pin" style={{ bottom: 12 + idx * 22 }}>
          <span className="workshop-builder-pin__dot" aria-hidden="true" />
          <span>@{b.displayName || b.login}</span>
          <span className="workshop-builder-pin__count">{b.shipped}</span>
        </div>
      ))}
    </div>
  );
}

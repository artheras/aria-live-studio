import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
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

interface ProjectedLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
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
  const [projectedIdeas, setProjectedIdeas] = useState<Record<string, ProjectedLabel>>({});
  const [projectedBuilders, setProjectedBuilders] = useState<Record<string, ProjectedLabel>>({});

  const prevPhaseRef = useRef(state.round?.phase ?? "idle");
  const lastCelebrationIdRef = useRef<string | null>(null);
  const burstFnRef = useRef<((colorHex: number, origin?: { x: number; y: number; z: number }) => void) | null>(null);
  const petUntilRef = useRef<number>(0);

  useEffect(() => {
    const phase = state.round?.phase ?? "idle";
    if (phase !== prevPhaseRef.current) {
      if (phase === "collecting") burstFnRef.current?.(0x9146ff);
      if (phase === "voting") burstFnRef.current?.(0xf5b942);
      if (phase === "done") burstFnRef.current?.(0x30d88b);
      prevPhaseRef.current = phase;
    }
  }, [state.round?.phase]);

  useEffect(() => {
    const latest = state.celebrations?.at(-1);
    if (!latest || latest.id === lastCelebrationIdRef.current) return;
    lastCelebrationIdRef.current = latest.id;
    const hex = latest.kind === "bits" || latest.kind === "channel_points" ? 0xf5b942 : 0xb589ff;
    burstFnRef.current?.(hex);
    petUntilRef.current = Date.now() + 15_000;
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
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x22173b, 0.0055);

    // Classic isometric pitch matching voxel-workshop.jpg (frames deep cliff cone, roots, and castle spire)
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 160);
    if (compact) {
      camera.position.set(16.2, 8.2, 16.6);
    } else {
      camera.position.set(15.4, 7.6, 15.8);
    }

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Gentle bloom so windows glow richly without blowing out the front porch
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.34, 0.46, 0.82));
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.12;
    controls.minDistance = 7.0;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0.45, compact ? 0.65 : 0.45, -0.35);

    // Twilight sky dome mapped to the isometric camera view (dir.y spans -0.60 at bottom to +0.05 at top)
    const skyGeo = new THREE.SphereGeometry(76, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x16112e) },
        midColor: { value: new THREE.Color(0x4b3175) },
        horizonColor: { value: new THREE.Color(0xf29f6d) },
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
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.56, -0.22, h));
          col = mix(col, topColor, smoothstep(-0.26, 0.04, h));
          float sunGlow = pow(max(dot(dir, normalize(vec3(0.55, -0.36, -0.75))), 0.0), 3.0);
          col = mix(col, vec3(0.99, 0.78, 0.52), sunGlow * 0.62);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    if (!transparent) {
      scene.add(new THREE.Mesh(skyGeo, skyMat));
    }

    // Balanced 3-point twilight lighting so shadow-side stone bricks stay legible & richly textured
    scene.add(new THREE.HemisphereLight(0xe4d2ff, 0x45355c, 1.48));

    const sun = new THREE.DirectionalLight(0xffd2a4, 2.15);
    sun.position.set(16, 18, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 48;
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 13;
    sun.shadow.camera.bottom = -13;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const frontFill = new THREE.DirectionalLight(0xb898ff, 0.92);
    frontFill.position.set(-14, 10, 12);
    scene.add(frontFill);

    const crystalLight = new THREE.PointLight(0x9d5cff, 4.2, 13);
    crystalLight.position.set(0.3, 3.6, 3.0);
    scene.add(crystalLight);

    const porchLight = new THREE.PointLight(0xffb44c, 3.6, 7.5);
    porchLight.position.set(-0.75, 1.55, 2.35);
    scene.add(porchLight);

    const underGlow = new THREE.PointLight(0x8b4dff, 3.8, 13);
    underGlow.position.set(0, -3.5, 0);
    scene.add(underGlow);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    // 0.5-unit beveled sub-voxel unit gives crisp brick edges & highlights
    const u = 0.5;
    const voxelGeo = new RoundedBoxGeometry(0.472, 0.472, 0.472, 2, 0.042);

    const stoneLightMat = new THREE.MeshStandardMaterial({ color: 0x9e94ad, roughness: 0.84 });
    const stoneMidMat = new THREE.MeshStandardMaterial({ color: 0x7e748d, roughness: 0.86 });
    const stoneDarkMat = new THREE.MeshStandardMaterial({ color: 0x5c536a, roughness: 0.9 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x6b5040, roughness: 0.92 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5ba158, roughness: 0.78 });
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x78bd63, roughness: 0.76 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x397644, roughness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xb67b48, roughness: 0.76 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x5e381e, roughness: 0.86 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x352e46, roughness: 0.72 });
    const roofLightMat = new THREE.MeshStandardMaterial({ color: 0x4f4663, roughness: 0.7 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xf0dbff,
      emissive: 0xa855f7,
      emissiveIntensity: 1.75,
      roughness: 0.18,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe49e,
      emissive: 0xffa028,
      emissiveIntensity: 1.65,
      roughness: 0.18,
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

    // 1. High-density 24x24 Floating Cliff Island (stepped stone cliff, dirt, 2-tier mossy grass)
    for (let gx = -11; gx <= 11; gx++) {
      for (let gz = -11; gz <= 11; gz++) {
        const x = gx * u;
        const z = gz * u;
        const dist = Math.abs(gx) + Math.abs(gz);
        const maxC = Math.max(Math.abs(gx), Math.abs(gz));
        if (maxC > 11 || dist > 16) continue;

        const onUpperTerrace = gx >= -5 && gx <= 6 && gz >= -6 && gz <= 2;
        if (onUpperTerrace) {
          pushStone(x, 0.5, z);
          pushStone(x, 0.0, z);
        } else {
          if ((gx + gz) % 3 === 0) mossSpecs.push({ x, y: 0.04, z });
          else grassSpecs.push({ x, y: 0.0, z });
        }

        // Deep craggy inverted-cone cliff underside matching voxel-workshop.jpg
        if (dist <= 16) dirtSpecs.push({ x, y: -0.5, z });
        if (dist <= 16 && (maxC <= 10 || (gx + gz) % 2 === 0)) pushStone(x, -1.0, z);
        if (dist <= 15 && maxC <= 10) pushStone(x, -1.5, z);
        if (dist <= 14 && maxC <= 9) stoneDarkSpecs.push({ x, y: -2.0, z });
        if (dist <= 13 && maxC <= 8) pushStone(x, -2.5, z);
        if (dist <= 11 && maxC <= 7) stoneDarkSpecs.push({ x, y: -3.0, z });
        if (dist <= 9 && maxC <= 6) stoneDarkSpecs.push({ x, y: -3.5, z });
        if (dist <= 7 && maxC <= 5) stoneDarkSpecs.push({ x, y: -4.0, z });
        if (dist <= 5 && maxC <= 4) stoneDarkSpecs.push({ x, y: -4.5, z });
        if (dist <= 4 && maxC <= 3) stoneDarkSpecs.push({ x, y: -5.0, z });
        if (dist <= 3) stoneDarkSpecs.push({ x, y: -5.5, z });
        if (dist <= 2) stoneDarkSpecs.push({ x, y: -6.0, z });
        if (dist <= 1) stoneDarkSpecs.push({ x, y: -6.5, z });
      }
    }
    // Irregular corner rock stalactites, hanging moss lips & branched wooden cliff roots
    for (const [rx, rz] of [
      [-4.0, 2.5],
      [4.0, 2.0],
      [2.5, -4.0],
      [-3.5, -3.5],
      [0.0, 4.5],
      [-2.0, 4.2],
      [3.2, 3.4],
      [0.2, 0.2],
    ] as const) {
      stoneDarkSpecs.push({ x: rx, y: -2.5, z: rz, sx: 1.4, sy: 2.8, sz: 1.4 });
      mossSpecs.push({ x: rx, y: -0.45, z: rz, sx: 1.0, sy: 1.4, sz: 1.0 });
    }
    // Branched primary + secondary roots dangling below the floating island
    for (const [vx, vz, len] of [
      [-4.4, 2.8, 5],
      [-3.6, 3.8, 6],
      [-2.2, 4.6, 5],
      [-0.8, 4.9, 4],
      [1.2, 4.7, 6],
      [2.8, 4.1, 5],
      [4.2, 2.8, 6],
      [4.8, 1.2, 4],
      [-4.8, 0.8, 5],
      [0.4, 3.4, 6],
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

    // 2. Grand 7-Step Front Stone Staircase + Cheek Parapet Walls
    for (let s = 0; s < 7; s++) {
      const sy = 0.12 + s * 0.12;
      const sz = 4.4 - s * 0.42;
      for (let wx = -3; wx <= -1; wx++) {
        pushStone(wx * u, sy, sz, 1, 0.75, 0.95);
      }
      pushStone(-2.0, sy + 0.25, sz, 0.72, 1.15, 0.95);
      pushStone(0.0, sy + 0.25, sz, 0.72, 1.15, 0.95);
    }
    stoneLightSpecs.push({ x: -2.0, y: 0.45, z: 4.75 }, { x: 0.0, y: 0.45, z: 4.75 });

    // 3. Main Two-Story Gabled Manor Hall (fine 0.5u stone masonry, dark wood door, arched purple windows)
    for (let gy = 2; gy <= 7; gy++) {
      const y = gy * u;
      for (let gx = -5; gx <= 2; gx++) {
        for (let gz = -4; gz <= 2; gz++) {
          const isOuter = gx === -5 || gx === 2 || gz === -4 || gz === 2;
          if (!isOuter) continue;
          const x = gx * u;
          const z = gz * u;
          const isDoor = gz === 2 && (gx === -2 || gx === -1) && (gy === 2 || gy === 3);
          const isFrontWin = gz === 2 && (gx === 0 || gx === 1) && (gy === 4 || gy === 5);
          const isBackWin = gz === -4 && (gx === -3 || gx === 0) && (gy === 4 || gy === 5);
          const isSideWin = gx === -5 && (gz === -1 || gz === 0) && (gy === 4 || gy === 5);
          const isCorner = (gx === -5 || gx === 2) && (gz === -4 || gz === 2);

          if (isDoor) {
            // Recessed dark wooden double doors instead of blinding solid glow
            timberSpecs.push({ x, y, z: z - 0.12, sx: 0.95, sy: 0.95, sz: 0.55 });
          } else if (isFrontWin) {
            pushFramedWindow(x, y, z, 0, 1, gy === 4);
          } else if (isBackWin) {
            pushFramedWindow(x, y, z, 0, -1, gy === 4);
          } else if (isSideWin) {
            pushFramedWindow(x, y, z, -1, 0, gy === 4);
          } else if (isCorner) {
            timberSpecs.push({ x, y, z });
          } else {
            pushStone(x, y, z);
          }
        }
      }
    }
    // Warm porch canopy + 3 slender timber columns + twin hanging amber lanterns
    timberSpecs.push(
      { x: -1.55, y: 1.35, z: 1.55, sx: 0.42, sy: 2.2, sz: 0.42 },
      { x: -0.75, y: 1.35, z: 1.55, sx: 0.36, sy: 2.2, sz: 0.36 },
      { x: 0.05, y: 1.35, z: 1.55, sx: 0.42, sy: 2.2, sz: 0.42 },
      { x: -0.75, y: 2.05, z: 1.4, sx: 3.8, sy: 0.5, sz: 1.8 },
    );
    lanternSpecs.push(
      { x: -1.55, y: 1.65, z: 1.82, sx: 0.45, sy: 0.55, sz: 0.45 },
      { x: 0.05, y: 1.65, z: 1.82, sx: 0.45, sy: 0.55, sz: 0.45 },
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
    pushStone(-1.6, 5.2, -1.6, 1.2, 2.6, 1.2);
    stoneLightSpecs.push(
      { x: -1.6, y: 6.1, z: -1.6, sx: 1.45, sy: 0.45, sz: 1.45 },
      { x: -1.55, y: 6.65, z: -1.55, sx: 0.55, sy: 0.55, sz: 0.55 },
      { x: -1.4, y: 7.2, z: -1.45, sx: 0.72, sy: 0.72, sz: 0.72 },
      { x: -1.2, y: 7.85, z: -1.3, sx: 0.88, sy: 0.82, sz: 0.88 },
    );
    windowSpecs.push({ x: 1.35, y: 4.5, z: -0.25, sx: 0.7, sy: 1.0, sz: 0.9 });
    pushRoof(1.25, 5.05, -0.25, 1.2, 0.6, 1.6);
    // Wooden crane beam & pulley block on top of right scaffolding + front wishing well + flowerbed
    scaffSpecs.push(
      { x: 4.55, y: 6.2, z: -0.5, sx: 0.34, sy: 3.4, sz: 0.34 },
      { x: 4.55, y: 7.0, z: 0.25, sx: 0.34, sy: 0.34, sz: 3.6 },
      { x: 4.55, y: 6.3, z: 0.95, sx: 0.16, sy: 2.4, sz: 0.16 },
      { x: 4.55, y: 5.55, z: 0.95, sx: 0.75, sy: 0.85, sz: 0.75 },
      // Wishing well roof & posts (front-left garden)
      { x: -3.55, y: 1.15, z: 1.45, sx: 0.22, sy: 2.1, sz: 0.22 },
      { x: -2.85, y: 1.15, z: 1.45, sx: 0.22, sy: 2.1, sz: 0.22 },
      { x: -3.2, y: 1.75, z: 1.45, sx: 1.9, sy: 0.45, sz: 1.5 },
      // Window flowerbox planter
      { x: 0.35, y: 0.78, z: 1.48, sx: 2.4, sy: 0.55, sz: 0.75 },
    );
    stoneLightSpecs.push(
      { x: -3.2, y: 0.52, z: 1.45, sx: 1.55, sy: 0.95, sz: 1.55 },
    );

    // 4. Right-Wing Gallery (connecting Main Hall & Watchtower)
    for (let gy = 2; gy <= 5; gy++) {
      const y = gy * u;
      for (let gx = 3; gx <= 6; gx++) {
        for (let gz = -2; gz <= 1; gz++) {
          const isFrontWingWin = (gy === 3 || gy === 4) && gz === 1 && gx === 4;
          const isSideWingWin = (gy === 3 || gy === 4) && gx === 6 && gz === 0;
          if (isFrontWingWin) pushFramedWindow(gx * u, y, gz * u, 0, 1, gy === 3);
          else if (isSideWingWin) pushFramedWindow(gx * u, y, gz * u, 1, 0, gy === 3);
          else pushStone(gx * u, y, gz * u);
        }
      }
    }
    for (let gx = 3; gx <= 6; gx++) {
      if (gx % 2 === 1) pushStone(gx * u, 3.0, 0.5, 0.85, 0.85, 0.85);
    }

    // 5. Back-Right Workshop Turret + Battlements + Stepped Slate Pyramid + Guild Flag
    for (let gy = 2; gy <= 9; gy++) {
      const y = gy * u;
      for (let gx = 3; gx <= 7; gx++) {
        for (let gz = -7; gz <= -3; gz++) {
          const isOuter = gx === 3 || gx === 7 || gz === -7 || gz === -3;
          if (!isOuter) continue;
          const x = gx * u;
          const z = gz * u;
          const isWin =
            (gy === 7 || gy === 8) &&
            ((gz === -3 && gx === 5) || (gx === 3 && gz === -5) || (gz === -7 && gx === 5) || (gx === 7 && gz === -5));
          if (isWin) {
            const nx = gx === 3 ? -1 : gx === 7 ? 1 : 0;
            const nz = gz === -3 ? 1 : gz === -7 ? -1 : 0;
            pushFramedWindow(x, y, z, nx, nz, gy === 7);
          } else {
            pushStone(x, y, z);
          }
        }
      }
    }
    // Turret corbelled battlements & 3-tier slate pyramid cap
    for (let gx = 2; gx <= 8; gx++) {
      for (let gz = -8; gz <= -2; gz++) {
        const isEdge = gx === 2 || gx === 8 || gz === -8 || gz === -2;
        if (!isEdge) continue;
        if ((gx + gz) % 2 === 0) pushStone(gx * u, 5.0, gz * u);
        pushStone(gx * u, 4.6, gz * u);
      }
    }
    for (let tier = 0; tier < 3; tier++) {
      const y = 5.45 + tier * 0.45;
      const minG = 3 + tier;
      const maxG = 7 - tier;
      for (let gx = minG; gx <= maxG; gx++) {
        for (let gz = -7 + tier; gz <= -3 - tier; gz++) {
          pushRoof(gx * u, y, gz * u);
        }
      }
    }

    const bannerGroup = new THREE.Group();
    bannerGroup.position.set(2.5, 6.8, -2.5);
    const pole = new THREE.Mesh(voxelGeo, darkWoodMat);
    pole.scale.set(0.22, 1.8, 0.22);
    pole.position.y = 0.35;
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0x9146ff,
      emissive: 0x5b21b6,
      emissiveIntensity: 0.55,
      roughness: 0.55,
    });
    const flagCloth = new THREE.Mesh(voxelGeo, flagMat);
    flagCloth.scale.set(1.5, 0.85, 0.16);
    flagCloth.position.set(0.4, 0.55, 0);
    bannerGroup.add(pole, flagCloth);
    islandGroup.add(bannerGroup);

    // 6. Intricate Multi-Tier Wooden Scaffolding (right watchtower + left manor)
    scaffSpecs.push(
      { x: 4.15, y: 3.3, z: -3.4, sx: 0.32, sy: 12.2, sz: 0.32 },
      { x: 4.15, y: 3.3, z: -1.2, sx: 0.32, sy: 12.2, sz: 0.32 },
      { x: 4.15, y: 2.2, z: 0.35, sx: 0.32, sy: 7.4, sz: 0.32 },
      { x: 4.95, y: 3.3, z: -3.4, sx: 0.32, sy: 12.2, sz: 0.32 },
      { x: 4.95, y: 3.3, z: -1.2, sx: 0.32, sy: 12.2, sz: 0.32 },
      { x: 4.95, y: 2.2, z: 0.35, sx: 0.32, sy: 7.4, sz: 0.32 },
      { x: 4.55, y: 2.1, z: -1.5, sx: 2.1, sy: 0.28, sz: 7.8 },
      { x: 4.55, y: 3.8, z: -2.3, sx: 2.1, sy: 0.28, sz: 4.8 },
      { x: 4.55, y: 5.4, z: -2.3, sx: 2.1, sy: 0.28, sz: 4.8 },
      { x: 4.95, y: 2.95, z: -2.3, sx: 0.22, sy: 0.22, sz: 4.6 },
      { x: 4.95, y: 4.6, z: -2.3, sx: 0.22, sy: 0.22, sz: 4.6 },
      // Left scaffolding
      { x: -3.15, y: 1.9, z: -0.9, sx: 0.28, sy: 6.2, sz: 0.28 },
      { x: -3.15, y: 1.9, z: 0.9, sx: 0.28, sy: 6.2, sz: 0.28 },
      { x: -2.8, y: 2.0, z: 0.0, sx: 1.7, sy: 0.26, sz: 3.9 },
      { x: -2.8, y: 3.2, z: 0.0, sx: 1.7, sy: 0.26, sz: 3.9 },
      // Courtyard crates & wooden bench
      { x: 2.1, y: 0.72, z: 1.6, sx: 0.95, sy: 0.95, sz: 0.95 },
      { x: 2.7, y: 0.68, z: 1.5, sx: 0.78, sy: 0.85, sz: 0.78 },
      { x: 1.1, y: 0.62, z: 2.6, sx: 1.7, sy: 0.42, sz: 0.72 },
    );
    for (let r = 0; r < 7; r++) {
      scaffSpecs.push({ x: 4.98, y: 1.1 + r * 0.65, z: -2.3, sx: 0.2, sy: 0.2, sz: 1.4 });
    }
    lanternSpecs.push(
      { x: 4.95, y: 3.45, z: -1.2, sx: 0.45, sy: 0.55, sz: 0.45 },
      { x: 0.65, y: 0.78, z: 3.45, sx: 0.4, sy: 0.5, sz: 0.4 },
      { x: -2.35, y: 1.85, z: 1.15, sx: 0.4, sy: 0.5, sz: 0.4 },
      { x: -1.4, y: 1.45, z: -2.35, sx: 0.42, sy: 0.52, sz: 0.42 },
    );

    // 7. Fine-Detail Clustered Sub-Voxel Pine Trees, Shrubs, Cobblestones & Flowers
    const trunkSpecs: VoxelSpec[] = [
      { x: -4.2, y: 1.15, z: -1.6, sx: 0.85, sy: 3.4, sz: 0.85 },
      { x: -4.0, y: 1.0, z: 2.6, sx: 0.78, sy: 2.8, sz: 0.78 },
      { x: 4.1, y: 1.0, z: 2.6, sx: 0.78, sy: 2.8, sz: 0.78 },
      { x: -2.2, y: 0.95, z: -4.0, sx: 0.72, sy: 2.4, sz: 0.72 },
    ];
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
              sx: 0.82,
              sy: 0.84,
              sz: 0.82,
            });
          }
        }
      }
      pineSpecs.push({ x: cx, y: baseY + tiers * 0.44, z: cz, sx: 0.75, sy: 0.85, sz: 0.75 });
    };
    addFineTree(-4.35, 1.8, -1.5, 5);
    addFineTree(-4.2, 1.5, 1.1, 5);
    addFineTree(-3.8, 1.4, 2.9, 4);
    addFineTree(4.3, 1.6, 2.4, 4);
    addFineTree(5.1, 1.5, -0.4, 4);
    addFineTree(-2.3, 1.6, -4.1, 4);

    // Shrubs & courtyard stepping stones
    for (const [sx, sz] of [
      [-3.1, 3.6],
      [-2.4, 4.1],
      [1.8, 3.8],
      [3.2, 0.9],
      [4.2, -0.4],
    ] as const) {
      mossSpecs.push({ x: sx, y: 0.38, z: sz, sx: 1.05, sy: 0.9, sz: 1.05 });
      pineSpecs.push({ x: sx + 0.22, y: 0.62, z: sz - 0.14, sx: 0.72, sy: 0.72, sz: 0.72 });
    }
    for (const [cx, cz] of [
      [-1.0, 4.9],
      [-0.4, 4.6],
      [0.6, 3.6],
      [1.6, 3.1],
      [2.5, 2.5],
    ] as const) {
      stoneLightSpecs.push({ x: cx, y: 0.28, z: cz, sx: 1.05, sy: 0.25, sz: 1.05 });
    }

    const blossomPinkMat = new THREE.MeshStandardMaterial({ color: 0xe672a5, roughness: 0.62 });
    const blossomGoldMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.58 });

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
        { x: -2.9, y: 0.38, z: 3.2, sx: 0.45, sy: 0.48, sz: 0.45 },
        { x: 0.9, y: 0.38, z: 3.9, sx: 0.45, sy: 0.48, sz: 0.45 },
        { x: 3.3, y: 0.38, z: 1.9, sx: 0.45, sy: 0.48, sz: 0.45 },
      ]),
    );
    islandGroup.add(
      buildVoxelInstances(voxelGeo, blossomGoldMat, [
        { x: -2.4, y: 0.38, z: 3.5, sx: 0.45, sy: 0.48, sz: 0.45 },
        { x: 2.3, y: 0.38, z: 3.3, sx: 0.45, sy: 0.48, sz: 0.45 },
      ]),
    );
    islandGroup.add(buildVoxelInstances(voxelGeo, crystalMat, windowSpecs, false, false));
    islandGroup.add(buildVoxelInstances(voxelGeo, lanternMat, lanternSpecs, false, false));
    // Glowing violet crystal courtyard lanterns along the front path (matching 2D artwork)
    const violetPostSpecs: VoxelSpec[] = [
      { x: -1.45, y: 0.42, z: 4.55, sx: 0.32, sy: 0.55, sz: 0.32 },
      { x: 0.35, y: 0.42, z: 4.95, sx: 0.32, sy: 0.55, sz: 0.32 },
      { x: 2.15, y: 0.42, z: 3.45, sx: 0.32, sy: 0.55, sz: 0.32 },
      { x: 3.45, y: 0.42, z: 2.15, sx: 0.32, sy: 0.55, sz: 0.32 },
    ];
    const violetOrbSpecs: VoxelSpec[] = violetPostSpecs.map((p) => ({
      x: p.x,
      y: p.y + 0.34,
      z: p.z,
      sx: 0.44,
      sy: 0.44,
      sz: 0.44,
    }));
    islandGroup.add(buildVoxelInstances(voxelGeo, stoneDarkMat, violetPostSpecs));
    islandGroup.add(buildVoxelInstances(voxelGeo, crystalMat, violetOrbSpecs, false, false));

    // 8. 4 Animated Voxel Co-Builder Characters on the courtyard & lawn
    const voxelBuilders: { group: THREE.Group; baseY: number; phase: number; hopUntil: number }[] = [];
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6cba8, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2820, roughness: 0.84 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2f3348, roughness: 0.86 });
    const addVoxelBuilder = (x: number, y: number, z: number, shirtColor: number, rotY: number, phase: number) => {
      const g = new THREE.Group();
      const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.66 });
      const head = new THREE.Mesh(voxelGeo, skinMat);
      head.scale.set(0.68, 0.68, 0.68);
      head.position.y = 0.72;
      const hair = new THREE.Mesh(voxelGeo, hairMat);
      hair.scale.set(0.72, 0.25, 0.72);
      hair.position.y = 0.86;
      const body = new THREE.Mesh(voxelGeo, shirtMat);
      body.scale.set(0.64, 0.72, 0.44);
      body.position.y = 0.38;
      const leftLeg = new THREE.Mesh(voxelGeo, legMat);
      leftLeg.scale.set(0.26, 0.48, 0.28);
      leftLeg.position.set(-0.07, 0.11, 0);
      const rightLeg = new THREE.Mesh(voxelGeo, legMat);
      rightLeg.scale.set(0.26, 0.48, 0.28);
      rightLeg.position.set(0.07, 0.11, 0);
      g.add(head, hair, body, leftLeg, rightLeg);
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      islandGroup.add(g);
      voxelBuilders.push({ group: g, baseY: y, phase, hopUntil: 0 });
    };
    addVoxelBuilder(-2.55, 0.24, 3.25, 0xd96b98, 0.45, 0.0);
    addVoxelBuilder(-0.15, 0.24, 4.15, 0x9146ff, -0.35, 1.4);
    addVoxelBuilder(2.15, 0.24, 2.75, 0x4ca6ff, -0.8, 2.8);
    addVoxelBuilder(3.15, 0.24, 1.45, 0xf5b942, -1.1, 4.2);

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

    // 8d. Channel-Points / Raid Summoned Voxel Fox Pet (visible for 15s on celebrations)
    const petGroup = new THREE.Group();
    const petFurMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.65 });
    const petTipMat = new THREE.MeshStandardMaterial({ color: 0xfff7ed, roughness: 0.6 });
    const petBody = new THREE.Mesh(voxelGeo, petFurMat);
    petBody.scale.set(0.72, 0.48, 0.95);
    petBody.position.y = 0.24;
    const petHead = new THREE.Mesh(voxelGeo, petFurMat);
    petHead.scale.set(0.58, 0.52, 0.58);
    petHead.position.set(0, 0.48, 0.35);
    const petTail = new THREE.Mesh(voxelGeo, petTipMat);
    petTail.scale.set(0.28, 0.28, 0.56);
    petTail.position.set(0, 0.34, -0.45);
    petGroup.add(petBody, petHead, petTail);
    petGroup.visible = false;
    islandGroup.add(petGroup);

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
    addVoxelCloud(-7.6, 1.9, 0.6, 1.15);
    addVoxelCloud(7.6, 2.8, -3.2, 1.2);
    addVoxelCloud(-6.8, -4.1, 4.2, 1.3);
    addVoxelCloud(6.6, -3.9, 3.8, 1.25);
    bgIslands.add(buildVoxelInstances(voxelGeo, cloudShadeMat, cloudBotSpecs, false, false));
    bgIslands.add(buildVoxelInstances(voxelGeo, cloudLightMat, cloudTopSpecs, false, false));

    // Distant upper-left atmospheric mini floating island (silhouette depth from 2D reference)
    const farGrassMat = new THREE.MeshStandardMaterial({ color: 0x456b5a, roughness: 0.9 });
    const farStoneMat = new THREE.MeshStandardMaterial({ color: 0x3b3354, roughness: 0.92 });
    const farPineMat = new THREE.MeshStandardMaterial({ color: 0x2f4f46, roughness: 0.9 });
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farGrassMat,
        [{ x: -13.5, y: 4.5, z: -15.5, sx: 5.5, sy: 0.9, sz: 5.2 }],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        farStoneMat,
        [
          { x: -13.5, y: 3.6, z: -15.5, sx: 4.6, sy: 2.2, sz: 4.4 },
          { x: -13.5, y: 2.2, z: -15.5, sx: 2.8, sy: 2.0, sz: 2.8 },
          { x: -13.0, y: 5.4, z: -15.3, sx: 1.8, sy: 1.8, sz: 1.8 },
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
          { x: -14.8, y: 5.5, z: -15.6, sx: 1.3, sy: 2.2, sz: 1.3 },
          { x: -12.1, y: 5.3, z: -16.2, sx: 1.1, sy: 1.8, sz: 1.1 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        lanternMat,
        [{ x: -12.9, y: 5.3, z: -14.7, sx: 0.45, sy: 0.45, sz: 0.45 }],
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
    scene.add(makeMotes(0xd8bfff, 56));
    scene.add(makeMotes(0xb87cff, 84, -5.8, -1.6, 0.22));
    scene.add(makeMotes(0xffcb77, 32));
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

    // 3D Firework particle cubes (supports exact 3D hit origin + ground bounce)
    const bursts: BurstCube[] = [];
    const burstGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    burstFnRef.current = (colorHex: number, origin = { x: 0.5, y: 5.5, z: -1 }) => {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 1.9 });
      for (let i = 0; i < 20; i++) {
        const mesh = new THREE.Mesh(burstGeo, mat);
        mesh.position.set(origin.x, origin.y, origin.z);
        scene.add(mesh);
        const ang = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 0.055 + Math.random() * 0.085;
        bursts.push({
          mesh,
          vx: Math.cos(ang) * spd,
          vy: 0.065 + Math.random() * 0.09,
          vz: Math.sin(ang) * spd,
          life: 52,
        });
      }
    };

    // Raycaster for 3D click-to-burst & interactive character hops
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let petHopUntil = 0;

    const toNdc = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

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
      toNdc(e);
      raycaster.setFromCamera(pointerNdc, camera);
      const charRoots = [...voxelBuilders.map((v) => v.group), ...(petGroup.visible ? [petGroup] : [])];
      const hits = raycaster.intersectObjects(charRoots, true);
      renderer.domElement.style.cursor = hits.length > 0 ? "pointer" : "grab";
    };

    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      toNdc(e);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(islandGroup.children, true);
      const hit = hits[0];
      if (!hit) return;

      const nowMs = Date.now();
      const hitBuilder = voxelBuilders.find((vb) => isChildOf(hit.object, vb.group));
      if (hitBuilder) {
        hitBuilder.hopUntil = nowMs + 900;
        burstFnRef.current?.(0xf5b942, hit.point);
        return;
      }
      if (petGroup.visible && isChildOf(hit.object, petGroup)) {
        petHopUntil = nowMs + 1000;
        burstFnRef.current?.(0xffa62b, hit.point);
        return;
      }
      burstFnRef.current?.(0x9146ff, hit.point);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // 3D anchor points placed around the outer sky flanks so they never block the castle silhouette
    const ideaAnchors = [
      new THREE.Vector3(-7.0, 5.2, 1.5),
      new THREE.Vector3(6.5, 5.0, -3.5),
      new THREE.Vector3(-5.5, 2.0, 5.5),
      new THREE.Vector3(7.2, 2.4, 2.5),
    ];
    const builderAnchors = [
      new THREE.Vector3(-2.5, 1.5, 3.2),
      new THREE.Vector3(2.2, 1.5, 2.8),
      new THREE.Vector3(3.2, 1.5, 1.5),
    ];

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const w = Math.max(320, container.clientWidth);
            const h = Math.max(180, container.clientHeight);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            composer.setSize(w, h);
          })
        : null;
    ro?.observe(container);

    let raf = 0;
    let frame = 0;
    const vec = new THREE.Vector3();
    const targetTop = new THREE.Color();
    const targetMid = new THREE.Color();
    const targetHorizon = new THREE.Color();
    const targetCrystal = new THREE.Color();

    const animate = () => {
      frame += 1;
      const t = frame * 0.016;
      const phase = stateRef.current.round?.phase ?? "idle";
      const isCollecting = phase === "collecting";
      const isVoting = phase === "voting";
      const isBuilding = phase === "executing" || phase === "planning";

      // Dynamic theme & modifier palette morphing
      const pal = resolveThemePalette(stateRef.current.round?.prompt, stateRef.current.round?.modifiers);
      targetTop.setHex(pal.top);
      targetMid.setHex(pal.mid);
      targetHorizon.setHex(pal.horizon);
      targetCrystal.setHex(pal.crystal);
      skyMat.uniforms.topColor!.value.lerp(targetTop, 0.04);
      skyMat.uniforms.midColor!.value.lerp(targetMid, 0.04);
      skyMat.uniforms.horizonColor!.value.lerp(targetHorizon, 0.04);
      crystalMat.emissive.lerp(targetCrystal, 0.05);
      crystalLight.color.lerp(targetCrystal, 0.05);
      underGlow.color.lerp(targetCrystal, 0.05);

      const completedRounds = stateRef.current.stats?.rounds ?? 0;
      for (const m of milestoneTowers) {
        m.group.visible = completedRounds > m.idx;
        if (m.group.visible) {
          m.group.position.y = m.baseY + Math.sin(t * 2.0 + m.idx * 1.1) * 0.08;
          m.group.rotation.y = t * 0.6 + m.idx;
        }
      }

      islandGroup.position.y = Math.sin(t * 1.0) * 0.1;
      bgIslands.position.y = Math.sin(t * 0.6) * 0.16;
      bannerGroup.rotation.y = Math.sin(t * 2.6) * 0.22;
      crystalLight.intensity = isVoting
        ? 6.2 + Math.sin(t * 4.0) * 0.9
        : isCollecting
          ? 5.6 + Math.sin(t * 4.5) * 0.8
          : 4.6 + Math.sin(t * 3.0) * 0.6;
      porchLight.intensity = (isBuilding ? 4.4 : 3.6) + Math.sin(t * (isBuilding ? 7.5 : 5.2)) * 0.3;
      underGlow.intensity = isVoting ? 5.2 + Math.sin(t * 3.2) * 0.8 : 3.8;

      if (isBuilding && frame % 140 === 0) {
        burstFnRef.current?.(0xffb44c);
      }
      blueprintCube.visible = isBuilding;
      if (isBuilding) {
        blueprintCube.position.y = 5.95 + Math.abs(Math.sin(t * 2.8)) * 0.65;
        blueprintCube.rotation.y = t * 1.4;
      }

      const nowMs = Date.now();
      const petActive = nowMs < petUntilRef.current;
      petGroup.visible = petActive;
      if (petActive) {
        const ang = t * 1.5;
        const extraHop = nowMs < petHopUntil ? Math.sin(((petHopUntil - nowMs) / 1000) * Math.PI) * 0.65 : 0;
        petGroup.position.set(
          Math.cos(ang) * 1.9,
          0.24 + Math.abs(Math.sin(t * 6.0)) * 0.22 + extraHop,
          2.8 + Math.sin(ang) * 1.1,
        );
        petGroup.rotation.y = -ang + (nowMs < petHopUntil ? 0.25 : 0);
      }

      const bounceSpeed = isCollecting || isBuilding ? 3.8 : 2.4;
      for (const vb of voxelBuilders) {
        const hopping = nowMs < vb.hopUntil;
        const hopBoost = hopping ? Math.sin(((vb.hopUntil - nowMs) / 900) * Math.PI) * 0.55 : 0;
        vb.group.position.y =
          vb.baseY + Math.abs(Math.sin(t * bounceSpeed + vb.phase)) * (isBuilding ? 0.12 : 0.07) + hopBoost;
        vb.group.rotation.y += hopping ? 0.18 : Math.sin(t * 1.1 + vb.phase) * 0.004;
      }

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
        b.mesh.scale.setScalar(Math.max(0.01, b.life / 52));
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
      if (eco) {
        renderer.render(scene, camera);
      } else {
        composer.render();
      }

      if (frame % 2 === 0) {
        const curIdeas = (stateRef.current.round?.ideas.filter((i) => !i.hidden) ?? []).slice(-4);
        if (curIdeas.length > 0) {
          const nextIdeas: Record<string, ProjectedLabel> = {};
          for (let idx = 0; idx < curIdeas.length; idx++) {
            const id = curIdeas[idx]!.id;
            vec.copy(ideaAnchors[idx % ideaAnchors.length]!);
            vec.y += islandGroup.position.y;
            vec.project(camera);
            nextIdeas[id] = {
              id,
              x: (vec.x * 0.5 + 0.5) * 100,
              y: (-vec.y * 0.5 + 0.5) * 100,
              visible: vec.z < 1,
            };
          }
          setProjectedIdeas(nextIdeas);
        } else {
          setProjectedIdeas({});
        }
        const curBuilders = (stateRef.current.coBuilders ?? []).slice(0, 3);
        if (curBuilders.length > 0) {
          const nextBuilders: Record<string, ProjectedLabel> = {};
          curBuilders.forEach((b, idx) => {
            vec.copy(builderAnchors[idx % builderAnchors.length]!);
            vec.y += islandGroup.position.y;
            vec.project(camera);
            nextBuilders[b.login] = {
              id: b.login,
              x: (vec.x * 0.5 + 0.5) * 100,
              y: (-vec.y * 0.5 + 0.5) * 100,
              visible: vec.z < 1,
            };
          });
          setProjectedBuilders(nextBuilders);
        }
      }

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      burstFnRef.current = null;
    };
  }, []);

  const ideas = (state.round?.ideas.filter((i) => !i.hidden) ?? []).slice(-4);

  return (
    <div
      className="workshop-scene workshop-scene--3d"
      ref={mountRef}
      onDoubleClick={() => burstFnRef.current?.(0x9146ff)}
      title="Drag to orbit 360° · Scroll to zoom · Double-click for voxel burst"
    >
      {!webglReady && <img className="workshop-scene__art" src="/art/voxel-workshop.jpg" alt="Voxel Workshop Stage" />}

      {ideas.map((idea, idx) => {
        const anchorCoords = [
          { x: -7.0, y: 5.2, z: 1.5 },
          { x: 6.5, y: 5.0, z: -3.5 },
          { x: -5.5, y: 2.0, z: 5.5 },
          { x: 7.2, y: 2.4, z: 2.5 },
        ];
        if (compact) {
          return (
            <button
              key={idea.id}
              type="button"
              className={`workshop-bubble workshop-bubble--flank workshop-bubble--flank-${idx} ${idea.boosts ? "is-boosted" : ""}`}
              onClick={() => burstFnRef.current?.(idea.boosts ? 0xf5b942 : 0x9146ff, anchorCoords[idx % anchorCoords.length])}
            >
              <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
              <span className="workshop-bubble__text">{truncate(idea.text, 22)}</span>
              {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
            </button>
          );
        }
        const pos = projectedIdeas[idea.id];
        if (!pos?.visible) return null;
        return (
          <button
            key={idea.id}
            type="button"
            className={`workshop-bubble workshop-bubble--3d ${idea.boosts ? "is-boosted" : ""}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={() => burstFnRef.current?.(idea.boosts ? 0xf5b942 : 0x9146ff, anchorCoords[idx % anchorCoords.length])}
          >
            <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
            <span className="workshop-bubble__text">{truncate(idea.text, 24)}</span>
            {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
          </button>
        );
      })}

      {(state.coBuilders ?? []).slice(0, 3).map((b) => {
        const pos = projectedBuilders[b.login];
        if (!pos?.visible) return null;
        return (
          <div
            key={b.login}
            className="workshop-builder-pin"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <span className="workshop-builder-pin__dot" aria-hidden="true" />
            <span>@{b.displayName || b.login}</span>
            <span className="workshop-builder-pin__count">{b.shipped}</span>
          </div>
        );
      })}

      {!transparent && <span className="workshop-orbit-hint">360° Interactive · Drag to rotate · Scroll to zoom</span>}
    </div>
  );
}

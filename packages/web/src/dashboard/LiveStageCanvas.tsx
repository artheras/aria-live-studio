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

/** Interactive 3D voxel workshop island powered by Three.js with OrbitControls & 3D-projected idea bubbles. */
export function LiveStageCanvas({ state }: { state: LiveState }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [webglReady, setWebglReady] = useState(true);
  const [projectedIdeas, setProjectedIdeas] = useState<Record<string, ProjectedLabel>>({});
  const [projectedBuilders, setProjectedBuilders] = useState<Record<string, ProjectedLabel>>({});

  const prevPhaseRef = useRef(state.round?.phase ?? "idle");
  const lastCelebrationIdRef = useRef<string | null>(null);
  const burstFnRef = useRef<((colorHex: number) => void) | null>(null);

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
  }, [state.celebrations]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setWebglReady(false);
      return;
    }

    const width = Math.max(320, container.clientWidth || 640);
    const height = Math.max(180, container.clientHeight || 360);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x3a2a54, 0.011);

    // Classic 45-deg isometric hero view matching the reference workshop composition
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 160);
    camera.position.set(12.8, 9.0, 13.0);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Gentle bloom so windows glow richly without blowing out the front porch
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.28, 0.42, 0.85));
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.12;
    controls.minDistance = 8.5;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0.25, 2.55, -0.15);

    // Twilight sky dome with directional golden-peach sunset glow on upper-right
    const skyGeo = new THREE.SphereGeometry(76, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x281d45) },
        midColor: { value: new THREE.Color(0x6d4c8f) },
        horizonColor: { value: new THREE.Color(0xe6ad8a) },
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
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.2, 0.25, h));
          col = mix(col, topColor, smoothstep(0.22, 0.78, h));
          float sunGlow = pow(max(dot(dir, normalize(vec3(0.68, 0.2, -0.7))), 0.0), 3.2);
          col = mix(col, vec3(0.99, 0.82, 0.62), sunGlow * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

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
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x734828, roughness: 0.84 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x453e56, roughness: 0.72 });
    const roofLightMat = new THREE.MeshStandardMaterial({ color: 0x5c5371, roughness: 0.7 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xe6c8ff,
      emissive: 0x9146ff,
      emissiveIntensity: 1.55,
      roughness: 0.2,
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

        // Craggy cliff depth layers
        if (dist <= 15) dirtSpecs.push({ x, y: -0.5, z });
        if (dist <= 13 || (maxC === 10 && (gx * gz) % 2 === 0)) pushStone(x, -1.0, z);
        if (dist <= 11 || (gx % 3 === 0 && gz % 2 === 0 && dist <= 13)) stoneDarkSpecs.push({ x, y: -1.5, z });
        if (dist <= 9) stoneDarkSpecs.push({ x, y: -2.0, z });
        if (dist <= 6) stoneDarkSpecs.push({ x, y: -2.5, z });
        if (dist <= 3) stoneDarkSpecs.push({ x, y: -3.0, z });
      }
    }
    // Irregular corner rock stalactites & hanging moss lips
    for (const [rx, rz] of [
      [-4.0, 2.5],
      [4.0, 2.0],
      [2.5, -4.0],
      [-3.5, -3.5],
      [0.0, 4.5],
    ] as const) {
      stoneDarkSpecs.push({ x: rx, y: -2.0, z: rz, sx: 1.2, sy: 1.6, sz: 1.2 });
      mossSpecs.push({ x: rx, y: -0.35, z: rz, sx: 0.9, sy: 1.1, sz: 0.9 });
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
    // Right-side roof dormer & left-back stone chimney
    pushStone(-1.6, 5.2, -1.6, 1.2, 2.6, 1.2);
    stoneLightSpecs.push({ x: -1.6, y: 6.1, z: -1.6, sx: 1.45, sy: 0.45, sz: 1.45 });
    windowSpecs.push({ x: 1.35, y: 4.5, z: -0.25, sx: 0.7, sy: 1.0, sz: 0.9 });
    pushRoof(1.25, 5.05, -0.25, 1.2, 0.6, 1.6);

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

    // 5. Tall Square Watchtower (back-right) + Quoins + Battlements + Stepped Slate Pyramid + Guild Flag
    for (let gy = 2; gy <= 13; gy++) {
      const y = gy * u;
      for (let gx = 3; gx <= 7; gx++) {
        for (let gz = -7; gz <= -3; gz++) {
          const isOuter = gx === 3 || gx === 7 || gz === -7 || gz === -3;
          if (!isOuter) continue;
          const x = gx * u;
          const z = gz * u;
          const isWin =
            (gy === 10 || gy === 11) &&
            ((gz === -3 && gx === 5) || (gx === 3 && gz === -5) || (gz === -7 && gx === 5) || (gx === 7 && gz === -5));
          if (isWin) {
            const nx = gx === 3 ? -1 : gx === 7 ? 1 : 0;
            const nz = gz === -3 ? 1 : gz === -7 ? -1 : 0;
            pushFramedWindow(x, y, z, nx, nz, gy === 10);
          } else {
            pushStone(x, y, z);
          }
        }
      }
    }
    // Watchtower corbelled battlements & 4-tier slate pyramid cap
    for (let gx = 2; gx <= 8; gx++) {
      for (let gz = -8; gz <= -2; gz++) {
        const isEdge = gx === 2 || gx === 8 || gz === -8 || gz === -2;
        if (!isEdge) continue;
        if ((gx + gz) % 2 === 0) pushStone(gx * u, 7.0, gz * u);
        pushStone(gx * u, 6.6, gz * u);
      }
    }
    for (let tier = 0; tier < 3; tier++) {
      const y = 7.45 + tier * 0.45;
      const minG = 3 + tier;
      const maxG = 7 - tier;
      for (let gx = minG; gx <= maxG; gx++) {
        for (let gz = -7 + tier; gz <= -3 - tier; gz++) {
          pushRoof(gx * u, y, gz * u);
        }
      }
    }

    const bannerGroup = new THREE.Group();
    bannerGroup.position.set(2.5, 8.9, -2.5);
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
    addFineTree(-4.2, 2.0, -1.6, 4);
    addFineTree(-4.0, 1.7, 2.6, 3);
    addFineTree(4.1, 1.7, 2.6, 3);
    addFineTree(-2.2, 1.6, -4.0, 3);

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

    // 8. 4 Animated Voxel Co-Builder Characters on the courtyard & lawn
    const voxelBuilders: { group: THREE.Group; baseY: number; phase: number }[] = [];
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
      voxelBuilders.push({ group: g, baseY: y, phase });
    };
    addVoxelBuilder(-2.55, 0.24, 3.25, 0xd96b98, 0.45, 0.0);
    addVoxelBuilder(-0.15, 0.24, 4.15, 0x9146ff, -0.35, 1.4);
    addVoxelBuilder(2.15, 0.24, 2.75, 0x4ca6ff, -0.8, 2.8);
    addVoxelBuilder(3.15, 0.24, 1.45, 0xf5b942, -1.1, 4.2);

    // 9. Distant Waterfall Cliff Peaks + Soft Feathered Volumetric Cloud Sprites (zero hard bubble seams)
    const bgIslands = new THREE.Group();
    const makeCloudTexture = (innerHex: string, outerHex: string) => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext("2d");
      if (ctx) {
        const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
        g.addColorStop(0, innerHex);
        g.addColorStop(0.5, outerHex);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
      }
      return new THREE.CanvasTexture(c);
    };
    const coolCloudTex = makeCloudTexture("rgba(220, 202, 248, 0.42)", "rgba(145, 110, 195, 0.14)");
    const warmCloudTex = makeCloudTexture("rgba(255, 224, 196, 0.44)", "rgba(232, 173, 132, 0.15)");
    const addCloudBank = (tex: THREE.CanvasTexture, cx: number, cy: number, cz: number, count: number) => {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      for (let i = 0; i < count; i++) {
        const sp = new THREE.Sprite(mat);
        sp.position.set(cx + (i - count / 2) * 2.4, cy + Math.sin(i * 1.1) * 0.9, cz + Math.cos(i * 0.85) * 1.6);
        const s = 6.5 + (i % 3) * 2.4;
        sp.scale.set(s * 1.45, s * 0.85, 1);
        bgIslands.add(sp);
      }
    };
    addCloudBank(coolCloudTex, -15, 1.8, -15, 7);
    addCloudBank(coolCloudTex, -11, -3.0, -7, 6);
    addCloudBank(coolCloudTex, -10, -4.4, 5, 5);
    addCloudBank(warmCloudTex, 15, 2.4, -14, 7);
    addCloudBank(warmCloudTex, 11, -2.5, -6, 6);
    addCloudBank(warmCloudTex, 10, -3.8, 6, 5);

    const waterfallMat = new THREE.MeshStandardMaterial({
      color: 0xdff4ff,
      emissive: 0x7fd4ff,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      transparent: true,
      opacity: 0.85,
    });
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        grassMat,
        [
          { x: -17, y: 2.5, z: -20, sx: 9.0, sy: 1.3, sz: 8.5 },
          { x: -18.5, y: 4.1, z: -20.5, sx: 5.2, sy: 1.2, sz: 5.0 },
          { x: -19.2, y: 5.3, z: -21.0, sx: 2.8, sy: 1.1, sz: 2.8 },
          { x: 18, y: 1.6, z: -21, sx: 8.4, sy: 1.3, sz: 8.0 },
          { x: 19.5, y: 3.1, z: -21.5, sx: 4.6, sy: 1.2, sz: 4.4 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        stoneDarkMat,
        [
          { x: -17, y: 0.4, z: -20, sx: 7.4, sy: 6.2, sz: 7.0 },
          { x: -18.5, y: 3.0, z: -20.5, sx: 4.4, sy: 3.8, sz: 4.2 },
          { x: 18, y: -0.4, z: -21, sx: 6.8, sy: 6.2, sz: 6.4 },
          { x: 19.5, y: 2.1, z: -21.5, sx: 3.8, sy: 3.2, sz: 3.8 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        voxelGeo,
        waterfallMat,
        [
          { x: -17.2, y: 0.5, z: -17.8, sx: 1.3, sy: 7.8, sz: 0.9 },
          { x: 17.6, y: 0.0, z: -18.8, sx: 1.4, sy: 8.0, sz: 0.95 },
        ],
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

    // 3D Firework particle cubes
    const bursts: BurstCube[] = [];
    const burstGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    burstFnRef.current = (colorHex: number) => {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 1.9 });
      for (let i = 0; i < 20; i++) {
        const mesh = new THREE.Mesh(burstGeo, mat);
        mesh.position.set(0.5, 5.5, -1);
        scene.add(mesh);
        const ang = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 0.06 + Math.random() * 0.09;
        bursts.push({
          mesh,
          vx: Math.cos(ang) * spd,
          vy: 0.07 + Math.random() * 0.09,
          vz: Math.sin(ang) * spd,
          life: 48,
        });
      }
    };

    // 3D anchor points placed around the perimeter so they never block the castle silhouette
    const ideaAnchors = [
      new THREE.Vector3(-4.2, 4.8, 0.5),
      new THREE.Vector3(4.8, 4.2, 2.2),
      new THREE.Vector3(-3.2, 2.6, 4.6),
      new THREE.Vector3(5.6, 6.2, -1.5),
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

    const animate = () => {
      frame += 1;
      const t = frame * 0.016;
      const phase = stateRef.current.round?.phase ?? "idle";
      const isCollecting = phase === "collecting";
      const isVoting = phase === "voting";
      const isBuilding = phase === "executing" || phase === "planning";

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

      const bounceSpeed = isCollecting || isBuilding ? 3.8 : 2.4;
      for (const vb of voxelBuilders) {
        vb.group.position.y = vb.baseY + Math.abs(Math.sin(t * bounceSpeed + vb.phase)) * (isBuilding ? 0.12 : 0.07);
        vb.group.rotation.y += Math.sin(t * 1.1 + vb.phase) * 0.004;
      }

      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]!;
        b.mesh.position.x += b.vx;
        b.mesh.position.y += b.vy;
        b.mesh.position.z += b.vz;
        b.vy -= 0.004;
        b.mesh.rotation.x += 0.1;
        b.mesh.rotation.y += 0.12;
        b.life -= 1;
        b.mesh.scale.setScalar(Math.max(0.01, b.life / 50));
        if (b.life <= 0) {
          scene.remove(b.mesh);
          bursts.splice(i, 1);
        }
      }

      controls.update();
      composer.render();

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

      {ideas.map((idea) => {
        const pos = projectedIdeas[idea.id];
        if (!pos?.visible) return null;
        return (
          <div
            key={idea.id}
            className={`workshop-bubble workshop-bubble--3d ${idea.boosts ? "is-boosted" : ""}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
            <span className="workshop-bubble__text">{truncate(idea.text, 24)}</span>
            {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
          </div>
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

      <span className="workshop-orbit-hint">360° Interactive · Drag to rotate · Scroll to zoom</span>
    </div>
  );
}

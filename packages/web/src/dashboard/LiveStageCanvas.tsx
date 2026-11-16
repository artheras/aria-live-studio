import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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
  geo: THREE.BoxGeometry,
  mat: THREE.Material,
  specs: VoxelSpec[],
  castShadow = true,
  receiveShadow = true,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, specs.length);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  const dummy = new THREE.Object3D();
  specs.forEach((v, i) => {
    dummy.position.set(v.x, v.y, v.z);
    dummy.scale.set(v.sx ?? 1, v.sy ?? 1, v.sz ?? 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * High-detail 3D Voxel Castle-Workshop matching Image 1:
 * - Multi-tone textured stone masonry & two-tone voxel foliage
 * - Stepped front stone staircase with parapet walls & glowing warm porch
 * - Recessed/framed glowing Twitch-violet windows + pyramidal watchtower cap
 * - Dual wooden scaffolding (left & right), ladder rungs, crates & dual-color fireflies
 */
export function LiveStageCanvas({ state }: { state: LiveState }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const burstFnRef = useRef<((colorHex: number) => void) | null>(null);
  const lastCelebrationIdRef = useRef<string | null>(null);
  const [webglReady, setWebglReady] = useState(true);
  const [projectedIdeas, setProjectedIdeas] = useState<Record<string, ProjectedLabel>>({});
  const [projectedBuilders, setProjectedBuilders] = useState<Record<string, ProjectedLabel>>({});

  stateRef.current = state;
  const coBuilders = (state.coBuilders ?? []).slice(0, 3);

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
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x2d2142, 0.014);

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 160);
    camera.position.set(14.0, 9.2, 15.0);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.52, 0.45, 0.78));
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.minDistance = 8.5;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0.2, 2.5, 0);

    // Twilight sky dome
    const skyGeo = new THREE.SphereGeometry(76, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x191330) },
        midColor: { value: new THREE.Color(0x5c3d7b) },
        horizonColor: { value: new THREE.Color(0xe7ad84) },
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
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.18, 0.2, h));
          col = mix(col, topColor, smoothstep(0.18, 0.72, h));
          float sunGlow = pow(max(dot(dir, normalize(vec3(0.65, 0.16, -0.72))), 0.0), 4.0);
          col = mix(col, vec3(0.98, 0.79, 0.58), sunGlow * 0.45);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Lighting
    scene.add(new THREE.HemisphereLight(0xd5b8ff, 0x261c38, 1.08));

    const sun = new THREE.DirectionalLight(0xffcfa0, 2.35);
    sun.position.set(14, 17, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 48;
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 13;
    sun.shadow.camera.bottom = -13;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x9146ff, 0.95);
    rim.position.set(-12, 6, -12);
    scene.add(rim);

    const crystalLight = new THREE.PointLight(0x9146ff, 6.2, 13);
    crystalLight.position.set(0, 3.6, 1.3);
    scene.add(crystalLight);

    const porchLight = new THREE.PointLight(0xffb44c, 5.4, 8.5);
    porchLight.position.set(-0.6, 1.4, 2.9);
    scene.add(porchLight);

    const underGlow = new THREE.PointLight(0x8b4dff, 4.2, 13);
    underGlow.position.set(0, -3.8, 0);
    scene.add(underGlow);

    const wingGlow = new THREE.PointLight(0x9146ff, 3.8, 7.5);
    wingGlow.position.set(2.4, 2.5, 1.3);
    scene.add(wingGlow);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const boxGeo = new THREE.BoxGeometry(0.94, 0.94, 0.94);
    const stoneLightMat = new THREE.MeshStandardMaterial({ color: 0x7a7589, roughness: 0.85 });
    const stoneMidMat = new THREE.MeshStandardMaterial({ color: 0x615c70, roughness: 0.88 });
    const stoneDarkMat = new THREE.MeshStandardMaterial({ color: 0x433e50, roughness: 0.92 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x574236, roughness: 0.94 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4f8a59, roughness: 0.8 });
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x629e65, roughness: 0.78 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x316b43, roughness: 0.82 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x9b643a, roughness: 0.78 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x583721, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x393246, roughness: 0.72 });
    const roofLightMat = new THREE.MeshStandardMaterial({ color: 0x4e4560, roughness: 0.7 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xe2c7ff,
      emissive: 0x9146ff,
      emissiveIntensity: 2.5,
      roughness: 0.18,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe8ad,
      emissive: 0xffa62b,
      emissiveIntensity: 2.7,
      roughness: 0.15,
    });

    // Multi-tone masonry buckets
    const stoneLightSpecs: VoxelSpec[] = [];
    const stoneMidSpecs: VoxelSpec[] = [];
    const stoneDarkSpecs: VoxelSpec[] = [];
    const pushStone = (spec: VoxelSpec) => {
      const hash = Math.abs(Math.round(spec.x * 3 + spec.y * 5 + spec.z * 7)) % 5;
      if (hash === 0) stoneLightSpecs.push(spec);
      else if (hash === 4) stoneDarkSpecs.push(spec);
      else stoneMidSpecs.push(spec);
    };

    // 1. Craggy 13x13 floating rocky island + two-tier mossy grass terrace + overhanging cliff boulders
    const grassSpecs: VoxelSpec[] = [];
    const mossSpecs: VoxelSpec[] = [];
    const dirtSpecs: VoxelSpec[] = [];

    for (let x = -6; x <= 6; x++) {
      for (let z = -6; z <= 6; z++) {
        const dist = Math.abs(x) + Math.abs(z);
        if (dist > 8) continue;
        const onTerrace = x >= -2 && x <= 3 && z >= -3 && z <= 1;
        if (onTerrace) {
          pushStone({ x, y: 0.5, z });
        } else if ((x + z) % 3 === 0) {
          mossSpecs.push({ x, y: 0.08, z });
        } else {
          grassSpecs.push({ x, y: 0, z });
        }
        if (dist <= 7) dirtSpecs.push({ x, y: -1, z });
        if (dist <= 5 || (dist === 6 && (x * z) % 2 === 0)) stoneDarkSpecs.push({ x, y: -2, z });
        if (dist <= 4) stoneDarkSpecs.push({ x, y: -3, z });
        if (dist <= 2 || (dist === 3 && (x + z) % 2 === 0)) stoneDarkSpecs.push({ x, y: -4, z });
      }
    }
    stoneDarkSpecs.push(
      { x: 0, y: -5.2, z: 0 },
      { x: -1, y: -4.8, z: 1 },
      { x: 1, y: -4.7, z: -1 },
      { x: 2.5, y: -2.8, z: 2.5, sx: 0.9, sy: 1.25, sz: 0.9 },
      { x: -3.5, y: -2.6, z: 2.5, sx: 0.85, sy: 1.1, sz: 0.85 },
      { x: 4.5, y: -2.1, z: -1.5, sx: 0.85, sy: 1.0, sz: 0.85 },
      { x: -4.5, y: -2.1, z: -1.5, sx: 0.85, sy: 1.0, sz: 0.85 },
    );
    // Mossy grass lips & stone retaining wall along terrace edge
    for (let x = -3; x <= 4; x += 1) {
      if (x !== -1) pushStone({ x, y: 0.72, z: 1.85, sx: 0.75, sy: 0.45, sz: 0.4 });
    }
    mossSpecs.push(
      { x: -4.6, y: -0.35, z: 2.5, sx: 0.5, sy: 0.65, sz: 0.5 },
      { x: -4.6, y: -0.95, z: 2.5, sx: 0.35, sy: 0.65, sz: 0.35 },
      { x: -3.2, y: -0.65, z: 4.3, sx: 0.4, sy: 0.75, sz: 0.4 },
      { x: 4.5, y: -0.35, z: 1.5, sx: 0.5, sy: 0.7, sz: 0.5 },
      { x: 4.5, y: -1.0, z: 1.5, sx: 0.36, sy: 0.65, sz: 0.36 },
      { x: 2.5, y: -0.4, z: 4.5, sx: 0.55, sy: 0.65, sz: 0.55 },
      { x: 1.2, y: -0.75, z: 4.9, sx: 0.38, sy: 0.7, sz: 0.38 },
    );

    // Stepped 5-tier front stone staircase + parapet walls + newel posts + courtyard stepping stones
    for (let s = 0; s < 5; s++) {
      const sy = 0.16 + s * 0.22;
      const sz = 4.2 - s * 0.56;
      pushStone({ x: -1, y: sy, z: sz, sx: 1.55, sy: 0.28 + s * 0.12, sz: 0.54 });
      pushStone({ x: -2.0, y: sy + 0.24, z: sz, sx: 0.34, sy: 0.56, sz: 0.54 });
      pushStone({ x: 0.0, y: sy + 0.24, z: sz, sx: 0.34, sy: 0.56, sz: 0.54 });
    }
    stoneLightSpecs.push(
      { x: -2.0, y: 0.58, z: 4.5, sx: 0.42, sy: 0.48, sz: 0.42 },
      { x: 0.0, y: 0.58, z: 4.5, sx: 0.42, sy: 0.48, sz: 0.42 },
    );
    for (const [cx, cz] of [
      [-1.0, 4.9],
      [-0.4, 4.7],
      [0.6, 3.6],
      [1.6, 3.1],
      [2.5, 2.5],
    ] as const) {
      stoneLightSpecs.push({ x: cx, y: 0.48, z: cz, sx: 0.58, sy: 0.14, sz: 0.58 });
    }

    // 2. Main Gabled Stone & Timber Manor (framed purple windows, stone arches/mullions, bargeboards, dormer)
    const timberSpecs: VoxelSpec[] = [];
    const windowSpecs: VoxelSpec[] = [];
    const roofSpecs: VoxelSpec[] = [];
    const porchSpecs: VoxelSpec[] = [];

    for (let y = 1.5; y <= 3.5; y += 1) {
      for (let x = -2; x <= 1; x++) {
        for (let z = -2; z <= 1; z++) {
          const isCorner = (x === -2 || x === 1) && (z === -2 || z === 1);
          const isFrontWin = z === 1 && (x === 0 || x === 1) && y === 2.5;
          const isSideWin = x === -2 && z === 0 && y === 2.5;
          const isDoor = z === 1 && x === -1 && y === 1.5;
          if (isDoor) {
            porchSpecs.push({ x, y, z });
          } else if (isFrontWin || isSideWin) {
            windowSpecs.push({ x, y, z, sx: 0.76, sy: 0.88, sz: 0.76 });
            timberSpecs.push({ x, y: y - 0.5, z: z === 1 ? 1.45 : z, sx: 0.94, sy: 0.18, sz: 0.32 });
            // Center stone mullion & arch lintel
            const mx = z === 1 ? x : x - 0.38;
            const mz = z === 1 ? 1.38 : z;
            pushStone({ x: mx, y, z: mz, sx: z === 1 ? 0.12 : 0.2, sy: 0.88, sz: z === 1 ? 0.2 : 0.12 });
            pushStone({ x: mx, y: y + 0.52, z: mz, sx: z === 1 ? 0.92 : 0.28, sy: 0.2, sz: z === 1 ? 0.28 : 0.92 });
          } else if (isCorner) {
            timberSpecs.push({ x, y, z });
          } else {
            pushStone({ x, y, z });
          }
        }
      }
    }
    // Warm porch canopy + 3-post colonnade + stone arch lintel
    timberSpecs.push(
      { x: -1.65, y: 1.5, z: 1.8, sx: 0.22, sy: 1.6, sz: 0.22 },
      { x: -0.35, y: 1.5, z: 1.8, sx: 0.22, sy: 1.6, sz: 0.22 },
      { x: -1.0, y: 2.35, z: 1.65, sx: 1.72, sy: 0.26, sz: 0.92 },
    );
    stoneLightSpecs.push({ x: -1.0, y: 2.6, z: 1.85, sx: 1.45, sy: 0.22, sz: 0.28 });

    // Right-wing stone gallery connecting main hall & watchtower
    for (let y = 1.5; y <= 2.5; y += 1) {
      for (let x = 1.6; x <= 2.8; x += 1) {
        for (let z = -0.9; z <= 0.7; z += 0.8) {
          const isWingWin = y === 2.5 && ((z > 0.3 && x > 2.0) || (x > 2.4 && Math.abs(z) < 0.3));
          if (isWingWin) {
            windowSpecs.push({ x, y, z, sx: 0.68, sy: 0.85, sz: 0.68 });
          } else {
            pushStone({ x, y, z, sx: 0.88, sy: 0.96, sz: 0.82 });
          }
        }
      }
    }
    for (let x = 1.6; x <= 2.8; x += 0.6) {
      pushStone({ x, y: 3.35, z: 0.85, sx: 0.42, sy: 0.45, sz: 0.35 });
    }

    // Manor stepped pitched roof with overhanging eaves, ridge cresting & corner stone buttresses
    for (const [bx, bz] of [
      [-2.18, 1.18],
      [1.18, 1.18],
    ] as const) {
      pushStone({ x: bx, y: 2.0, z: bz, sx: 0.36, sy: 2.2, sz: 0.36 });
    }
    for (let z = -2.5; z <= 1.7; z += 1) {
      for (let x = -2.6; x <= 1.6; x += 1) {
        roofSpecs.push({ x, y: 4.3, z, sx: 0.96, sy: 0.65, sz: 0.96 });
      }
      for (let x = -1.6; x <= 0.6; x += 1) {
        roofSpecs.push({ x, y: 4.95, z, sx: 0.96, sy: 0.65, sz: 0.96 });
      }
      roofSpecs.push({ x: -0.5, y: 5.6, z, sx: 0.96, sy: 0.65, sz: 0.96 });
      if (Math.round(z * 10) % 2 === 0) {
        stoneLightSpecs.push({ x: -0.5, y: 6.04, z, sx: 0.32, sy: 0.28, sz: 0.38 });
      }
    }
    for (const gz of [1.85, -2.65]) {
      timberSpecs.push(
        { x: -2.1, y: 4.55, z: gz, sx: 0.95, sy: 0.22, sz: 0.22 },
        { x: -1.25, y: 5.2, z: gz, sx: 0.95, sy: 0.22, sz: 0.22 },
        { x: -0.5, y: 5.85, z: gz, sx: 0.95, sy: 0.22, sz: 0.22 },
        { x: 0.25, y: 5.2, z: gz, sx: 0.95, sy: 0.22, sz: 0.22 },
        { x: 1.1, y: 4.55, z: gz, sx: 0.95, sy: 0.22, sz: 0.22 },
      );
    }
    // Tall arched purple crystal gable window + center mullion + right-side roof dormer
    windowSpecs.push(
      { x: -0.5, y: 4.95, z: 1.65, sx: 0.94, sy: 1.08, sz: 0.42 },
      { x: 1.55, y: 4.65, z: -0.25, sx: 0.42, sy: 0.68, sz: 0.62 },
    );
    timberSpecs.push(
      { x: -0.5, y: 4.4, z: 1.72, sx: 1.18, sy: 0.16, sz: 0.3 },
      { x: -0.5, y: 4.95, z: 1.85, sx: 0.12, sy: 1.05, sz: 0.14 },
    );
    pushStone({ x: -0.5, y: 5.56, z: 1.8, sx: 1.16, sy: 0.2, sz: 0.28 });
    roofSpecs.push({ x: 1.45, y: 5.15, z: -0.25, sx: 0.72, sy: 0.36, sz: 0.9 });

    // 3. Tall Square Castle Watchtower (back-right) + Stone Quoins + Pyramidal Roof Cap
    for (let y = 1.5; y <= 6.5; y += 1) {
      for (let x = 1.5; x <= 3.5; x += 1) {
        for (let z = -3.5; z <= -1.5; z += 1) {
          const isTowerWin = y === 5.5 && ((z === -1.5 && x === 2.5) || (x === 1.5 && z === -2.5));
          if (isTowerWin) {
            windowSpecs.push({ x, y, z, sx: 0.78, sy: 0.96, sz: 0.78 });
            const mx = z === -1.5 ? 2.5 : 1.15;
            const mz = z === -1.5 ? -1.15 : -2.5;
            pushStone({ x: mx, y, z: mz, sx: 0.14, sy: 0.92, sz: 0.14 });
            pushStone({ x: mx, y: y + 0.56, z: mz, sx: z === -1.5 ? 0.92 : 0.28, sy: 0.2, sz: z === -1.5 ? 0.28 : 0.92 });
          } else {
            pushStone({ x, y, z });
          }
        }
      }
    }
    // Stone chimney on left-back roof slope + two-tone roof shingle split
    pushStone({ x: -1.65, y: 5.0, z: -1.45, sx: 0.68, sy: 0.9, sz: 0.68 });
    pushStone({ x: -1.65, y: 5.85, z: -1.45, sx: 0.64, sy: 0.9, sz: 0.64 });
    stoneLightSpecs.push({ x: -1.65, y: 6.4, z: -1.45, sx: 0.78, sy: 0.24, sz: 0.78 });

    // Watchtower corner stone quoins + corbelled battlements + stepped slate pyramid cap + finial
    for (let y = 1.5; y <= 6.5; y += 1) {
      for (const [qx, qz] of [
        [1.45, -1.45],
        [3.55, -1.45],
        [3.55, -3.55],
      ] as const) {
        (y % 2 === 0.5 ? stoneLightSpecs : stoneDarkSpecs).push({
          x: qx,
          y,
          z: qz,
          sx: 0.35,
          sy: 0.55,
          sz: 0.35,
        });
      }
    }
    for (let x = 1.3; x <= 3.7; x += 0.8) {
      for (let z = -3.7; z <= -1.3; z += 0.8) {
        if (Math.abs(x - 2.5) < 0.45 && Math.abs(z + 2.5) < 0.45) continue;
        pushStone({ x, y: 7.2, z, sx: 0.72, sy: 0.55, sz: 0.72 });
      }
    }
    for (let x = 1.8; x <= 3.2; x += 0.7) {
      for (let z = -3.2; z <= -1.8; z += 0.7) {
        roofSpecs.push({ x, y: 7.75, z, sx: 0.72, sy: 0.55, sz: 0.72 });
      }
    }
    roofSpecs.push(
      { x: 2.5, y: 8.35, z: -2.5, sx: 0.9, sy: 0.65, sz: 0.9 },
      { x: 2.5, y: 8.92, z: -2.5, sx: 0.36, sy: 0.55, sz: 0.36 },
    );

    // 4. Intricate 3-Tier Right Scaffolding + 2-Tier Left Scaffolding + Courtyard Props
    const scaffSpecs: VoxelSpec[] = [
      { x: 4.15, y: 3.1, z: -3.2, sx: 0.18, sy: 6.0, sz: 0.18 },
      { x: 4.15, y: 3.1, z: -1.1, sx: 0.18, sy: 6.0, sz: 0.18 },
      { x: 4.15, y: 2.1, z: 0.4, sx: 0.18, sy: 3.8, sz: 0.18 },
      { x: 5.05, y: 3.1, z: -3.2, sx: 0.18, sy: 6.0, sz: 0.18 },
      { x: 5.05, y: 3.1, z: -1.1, sx: 0.18, sy: 6.0, sz: 0.18 },
      { x: 5.05, y: 2.1, z: 0.4, sx: 0.18, sy: 3.8, sz: 0.18 },
      { x: 4.6, y: 2.2, z: -1.4, sx: 1.12, sy: 0.16, sz: 3.8 },
      { x: 4.6, y: 3.8, z: -2.15, sx: 1.12, sy: 0.16, sz: 2.3 },
      { x: 4.6, y: 5.3, z: -2.15, sx: 1.12, sy: 0.16, sz: 2.3 },
      { x: 5.05, y: 2.95, z: -2.15, sx: 0.12, sy: 0.12, sz: 2.2 },
      { x: 5.05, y: 4.55, z: -2.15, sx: 0.12, sy: 0.12, sz: 2.2 },
      { x: 4.2, y: 6.05, z: -2.15, sx: 1.4, sy: 0.16, sz: 0.18 },
      { x: 5.08, y: 1.3, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 1.9, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 2.5, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 3.1, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 3.7, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 4.3, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: -3.05, y: 2.0, z: -0.9, sx: 0.16, sy: 3.2, sz: 0.16 },
      { x: -3.05, y: 2.0, z: 0.9, sx: 0.16, sy: 3.2, sz: 0.16 },
      { x: -2.6, y: 2.1, z: 0.0, sx: 0.95, sy: 0.15, sz: 1.95 },
      { x: -2.6, y: 3.3, z: 0.0, sx: 0.95, sy: 0.15, sz: 1.95 },
      { x: -3.05, y: 2.7, z: 0.0, sx: 0.12, sy: 0.12, sz: 1.8 },
      // Courtyard crates, barrels, stone well & wooden bench
      { x: 2.2, y: 0.82, z: 1.6, sx: 0.56, sy: 0.56, sz: 0.56 },
      { x: 2.8, y: 0.78, z: 1.5, sx: 0.46, sy: 0.48, sz: 0.46 },
      { x: 1.1, y: 0.72, z: 2.8, sx: 0.95, sy: 0.24, sz: 0.42 },
      { x: 4.5, y: 2.55, z: -2.8, sx: 0.42, sy: 0.42, sz: 0.42 },
      { x: 4.5, y: 4.15, z: -1.6, sx: 0.4, sy: 0.44, sz: 0.4 },
    ];

    // Stone gable infill + courtyard stone well
    for (const gz of [1.2, -2.0]) {
      pushStone({ x: -1.5, y: 4.3, z: gz, sx: 0.9, sy: 0.65, sz: 0.75 });
      pushStone({ x: 0.5, y: 4.3, z: gz, sx: 0.9, sy: 0.65, sz: 0.75 });
    }
    pushStone({ x: 3.0, y: 0.72, z: 2.9, sx: 0.85, sy: 0.58, sz: 0.85 });

    // 5. Clustered Multi-Voxel Pine Trees, Shrubs & Wildflowers
    const trunkSpecs: VoxelSpec[] = [
      { x: -4.4, y: 1.15, z: -1.8, sx: 0.5, sy: 1.75, sz: 0.5 },
      { x: -4.1, y: 1.05, z: 2.5, sx: 0.46, sy: 1.4, sz: 0.46 },
      { x: 4.2, y: 1.05, z: 2.6, sx: 0.46, sy: 1.4, sz: 0.46 },
      { x: 4.6, y: 0.9, z: -3.9, sx: 0.36, sy: 1.05, sz: 0.36 },
    ];
    const pineSpecs: VoxelSpec[] = [];
    const addVoxelTreeCanopy = (cx: number, baseY: number, cz: number, tiers: number) => {
      for (let t = 0; t < tiers; t++) {
        const r = tiers - t;
        const y = baseY + t * 0.58;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
            const target = (dx + dz + t) % 3 === 0 ? mossSpecs : pineSpecs;
            target.push({
              x: cx + dx * 0.48,
              y: y + ((dx * dz) % 2) * 0.08,
              z: cz + dz * 0.48,
              sx: 0.54,
              sy: 0.56,
              sz: 0.54,
            });
          }
        }
      }
      pineSpecs.push({ x: cx, y: baseY + tiers * 0.58, z: cz, sx: 0.48, sy: 0.54, sz: 0.48 });
    };
    addVoxelTreeCanopy(-4.4, 2.05, -1.8, 4);
    addVoxelTreeCanopy(-4.1, 1.8, 2.5, 3);
    addVoxelTreeCanopy(4.2, 1.8, 2.6, 3);
    addVoxelTreeCanopy(4.6, 1.45, -3.9, 2);

    // Courtyard voxel shrubs & pink/gold wildflowers
    for (const [sx, sz] of [
      [-3.2, 3.6],
      [-2.5, 4.1],
      [1.8, 3.8],
      [3.1, 0.8],
      [4.2, -0.4],
    ] as const) {
      mossSpecs.push({ x: sx, y: 0.62, z: sz, sx: 0.58, sy: 0.52, sz: 0.58 });
      pineSpecs.push({ x: sx + 0.25, y: 0.82, z: sz - 0.15, sx: 0.42, sy: 0.42, sz: 0.42 });
    }

    // Glowing violet crystal shards nestled in the front garden & mossy rocks
    windowSpecs.push(
      { x: -3.55, y: 0.68, z: 3.25, sx: 0.24, sy: 0.42, sz: 0.24 },
      { x: -1.9, y: 0.66, z: 4.65, sx: 0.22, sy: 0.36, sz: 0.22 },
      { x: 3.45, y: 0.68, z: 1.15, sx: 0.24, sy: 0.44, sz: 0.24 },
      { x: 2.95, y: 0.64, z: 3.45, sx: 0.2, sy: 0.34, sz: 0.2 },
    );

    const blossomPinkMat = new THREE.MeshStandardMaterial({ color: 0xe06c9f, roughness: 0.65 });
    const blossomGoldMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6 });

    const roofLightSpecs = roofSpecs.filter((_, idx) => idx % 3 === 0);
    const roofDarkSpecs = roofSpecs.filter((_, idx) => idx % 3 !== 0);

    islandGroup.add(buildVoxelInstances(boxGeo, grassMat, grassSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, mossMat, mossSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, dirtMat, dirtSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneLightMat, stoneLightSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneMidMat, stoneMidSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneDarkMat, stoneDarkSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkWoodMat, [...timberSpecs, ...trunkSpecs]));
    islandGroup.add(buildVoxelInstances(boxGeo, woodMat, scaffSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, roofMat, roofDarkSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, roofLightMat, roofLightSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, pineMat, pineSpecs));
    islandGroup.add(
      buildVoxelInstances(boxGeo, blossomPinkMat, [
        { x: -2.9, y: 0.62, z: 3.2, sx: 0.24, sy: 0.26, sz: 0.24 },
        { x: 0.9, y: 0.62, z: 3.9, sx: 0.24, sy: 0.26, sz: 0.24 },
        { x: 3.3, y: 0.62, z: 1.9, sx: 0.24, sy: 0.26, sz: 0.24 },
      ]),
    );
    islandGroup.add(
      buildVoxelInstances(boxGeo, blossomGoldMat, [
        { x: -2.4, y: 0.62, z: 3.5, sx: 0.24, sy: 0.26, sz: 0.24 },
        { x: 2.3, y: 0.62, z: 3.3, sx: 0.24, sy: 0.26, sz: 0.24 },
      ]),
    );
    islandGroup.add(buildVoxelInstances(boxGeo, crystalMat, windowSpecs, false, false));
    islandGroup.add(
      buildVoxelInstances(
        boxGeo,
        lanternMat,
        [
          ...porchSpecs,
          { x: -1.85, y: 1.35, z: 2.35, sx: 0.28, sy: 0.36, sz: 0.28 },
          { x: -0.15, y: 1.35, z: 2.35, sx: 0.28, sy: 0.36, sz: 0.28 },
          { x: 0.55, y: 0.92, z: 3.7, sx: 0.22, sy: 0.28, sz: 0.22 },
          { x: -2.4, y: 2.0, z: 1.2, sx: 0.22, sy: 0.28, sz: 0.22 },
          { x: 5.02, y: 3.45, z: -1.1, sx: 0.24, sy: 0.3, sz: 0.24 },
          { x: 2.1, y: 3.2, z: -2.2, sx: 0.35, sy: 0.35, sz: 0.35 },
        ],
        false,
        false,
      ),
    );

    // Fluttering violet guild banner on top of the watchtower spire
    const bannerGroup = new THREE.Group();
    bannerGroup.position.set(2.5, 9.28, -2.5);
    const pole = new THREE.Mesh(boxGeo, darkWoodMat);
    pole.scale.set(0.1, 0.8, 0.1);
    pole.position.y = 0.3;
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0x9146ff,
      emissive: 0x5b21b6,
      emissiveIntensity: 0.6,
      roughness: 0.55,
    });
    const flagCloth = new THREE.Mesh(boxGeo, flagMat);
    flagCloth.scale.set(0.75, 0.42, 0.08);
    flagCloth.position.set(0.4, 0.46, 0);
    bannerGroup.add(pole, flagCloth);
    islandGroup.add(bannerGroup);

    // 6. 4 Animated 3D Voxel Co-Builder Characters on the courtyard & lawn
    const voxelBuilders: { group: THREE.Group; baseY: number; phase: number }[] = [];
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6cba8, roughness: 0.72 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2820, roughness: 0.85 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2f3348, roughness: 0.88 });
    const addVoxelBuilder = (x: number, y: number, z: number, shirtColor: number, rotY: number, phase: number) => {
      const g = new THREE.Group();
      const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.68 });
      const head = new THREE.Mesh(boxGeo, skinMat);
      head.scale.set(0.36, 0.36, 0.36);
      head.position.y = 0.78;
      const hair = new THREE.Mesh(boxGeo, hairMat);
      hair.scale.set(0.38, 0.14, 0.38);
      hair.position.y = 0.94;
      const body = new THREE.Mesh(boxGeo, shirtMat);
      body.scale.set(0.34, 0.38, 0.24);
      body.position.y = 0.42;
      const leftLeg = new THREE.Mesh(boxGeo, legMat);
      leftLeg.scale.set(0.14, 0.26, 0.16);
      leftLeg.position.set(-0.08, 0.12, 0);
      const rightLeg = new THREE.Mesh(boxGeo, legMat);
      rightLeg.scale.set(0.14, 0.26, 0.16);
      rightLeg.position.set(0.08, 0.12, 0);
      g.add(head, hair, body, leftLeg, rightLeg);
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      islandGroup.add(g);
      voxelBuilders.push({ group: g, baseY: y, phase });
    };
    addVoxelBuilder(-2.55, 0.5, 3.25, 0xd96b98, 0.45, 0.0);
    addVoxelBuilder(-0.15, 0.5, 4.15, 0x9146ff, -0.35, 1.4);
    addVoxelBuilder(2.15, 0.5, 2.75, 0x4ca6ff, -0.8, 2.8);
    addVoxelBuilder(3.15, 0.5, 1.45, 0xf5b942, -1.1, 4.2);

    // Distant floating background islands + waterfall cliff peaks + volumetric twilight voxel cloud banks
    const bgIslands = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xc9b4e6,
      emissive: 0x5c3d7b,
      emissiveIntensity: 0.35,
      roughness: 0.95,
      transparent: true,
      opacity: 0.72,
    });
    const cloudWarmMat = new THREE.MeshStandardMaterial({
      color: 0xf4c7a1,
      emissive: 0xe7ad84,
      emissiveIntensity: 0.3,
      roughness: 0.95,
      transparent: true,
      opacity: 0.68,
    });
    const cloudCoolSpecs: VoxelSpec[] = [];
    const cloudWarmSpecs: VoxelSpec[] = [];
    const addVoxelCloud = (specs: VoxelSpec[], cx: number, cy: number, cz: number, count: number) => {
      for (let i = 0; i < count; i++) {
        specs.push({
          x: cx + (i - count / 2) * 1.45,
          y: cy + Math.sin(i * 1.3) * 0.45,
          z: cz + Math.cos(i * 0.9) * 0.7,
          sx: 1.9 + (i % 2) * 0.7,
          sy: 1.15 + ((i + 1) % 2) * 0.45,
          sz: 1.7,
        });
      }
    };
    addVoxelCloud(cloudCoolSpecs, -14, 1.5, -13, 8);
    addVoxelCloud(cloudCoolSpecs, -11, -3.5, 4, 7);
    addVoxelCloud(cloudWarmSpecs, 14, 2.2, -12, 8);
    addVoxelCloud(cloudWarmSpecs, 11, -3.2, 6, 7);

    const waterfallMat = new THREE.MeshStandardMaterial({
      color: 0xdff4ff,
      emissive: 0x7fd4ff,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      transparent: true,
      opacity: 0.85,
    });
    bgIslands.add(buildVoxelInstances(boxGeo, cloudMat, cloudCoolSpecs, false, false));
    bgIslands.add(buildVoxelInstances(boxGeo, cloudWarmMat, cloudWarmSpecs, false, false));
    bgIslands.add(
      buildVoxelInstances(
        boxGeo,
        grassMat,
        [
          { x: -14, y: 2.5, z: -16, sx: 3.8, sy: 0.75, sz: 3.8 },
          { x: -15.5, y: 4.1, z: -16.5, sx: 2.1, sy: 0.65, sz: 2.1 },
          { x: 15, y: 1.8, z: -17, sx: 3.4, sy: 0.7, sz: 3.4 },
          { x: 16.5, y: 3.6, z: -17.5, sx: 2.2, sy: 0.65, sz: 2.2 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        boxGeo,
        stoneDarkMat,
        [
          { x: -14, y: 1.0, z: -16, sx: 2.8, sy: 2.4, sz: 2.8 },
          { x: -15.5, y: 3.0, z: -16.5, sx: 1.8, sy: 1.8, sz: 1.8 },
          { x: 15, y: 0.2, z: -17, sx: 2.5, sy: 2.6, sz: 2.5 },
          { x: 16.5, y: 2.4, z: -17.5, sx: 1.8, sy: 1.8, sz: 1.8 },
        ],
        false,
        false,
      ),
    );
    bgIslands.add(
      buildVoxelInstances(
        boxGeo,
        waterfallMat,
        [
          { x: -14.2, y: 0.6, z: -14.2, sx: 0.65, sy: 3.8, sz: 0.45 },
          { x: 14.6, y: 0.1, z: -15.4, sx: 0.72, sy: 3.9, sz: 0.48 },
        ],
        false,
        false,
      ),
    );
    scene.add(bgIslands);

    // Dual-color floating violet + warm gold fireflies + under-island violet glow motes
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
    scene.add(makeMotes(0xd8bfff, 48));
    scene.add(makeMotes(0xb87cff, 64, -6.0, -1.8, 0.22));
    scene.add(makeMotes(0xffcb77, 26));

    // 3D Firework particle cubes
    const bursts: BurstCube[] = [];
    const burstGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
    burstFnRef.current = (colorHex: number) => {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 2.2 });
      for (let i = 0; i < 20; i++) {
        const mesh = new THREE.Mesh(burstGeo, mat);
        mesh.position.set(0.5, 5.5, -1);
        scene.add(mesh);
        const ang = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 0.06 + Math.random() * 0.09;
        bursts.push({
          mesh,
          vx: Math.cos(ang) * spd,
          vy: 0.12 + Math.random() * 0.09,
          vz: Math.sin(ang) * spd,
          life: 50,
        });
      }
    };

    const ideaAnchors = [
      new THREE.Vector3(-2.6, 5.4, 1.8),
      new THREE.Vector3(3.2, 6.4, 0.4),
      new THREE.Vector3(-2.4, 5.6, -2.4),
      new THREE.Vector3(2.4, 4.6, 2.8),
    ];
    const builderAnchors = [
      new THREE.Vector3(-2.2, 1.8, 3.0),
      new THREE.Vector3(2.2, 1.8, 3.0),
      new THREE.Vector3(4.6, 4.4, -2.2),
    ];

    const ro = typeof ResizeObserver !== "undefined"
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

      islandGroup.position.y = Math.sin(t * 1.0) * 0.12;
      bgIslands.position.y = Math.sin(t * 0.6) * 0.18;
      bannerGroup.rotation.y = Math.sin(t * 2.6) * 0.22;
      crystalLight.intensity = isVoting
        ? 7.8 + Math.sin(t * 4.0) * 1.2
        : isCollecting
          ? 7.0 + Math.sin(t * 4.5) * 1.1
          : 5.6 + Math.sin(t * 3.0) * 0.9;
      porchLight.intensity = (isBuilding ? 6.6 : 5.2) + Math.sin(t * (isBuilding ? 7.5 : 5.2)) * 0.45;
      underGlow.intensity = isVoting ? 6.0 + Math.sin(t * 3.2) * 1.0 : 4.2;

      if (isBuilding && frame % 140 === 0) {
        burstFnRef.current?.(0xffb44c);
      }

      const bounceSpeed = isCollecting || isBuilding ? 3.8 : 2.4;
      for (const vb of voxelBuilders) {
        vb.group.position.y = vb.baseY + Math.abs(Math.sin(t * bounceSpeed + vb.phase)) * (isBuilding ? 0.12 : 0.08);
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
        const bubbleCount = curIdeas.length > 0 ? curIdeas.length : 4;
        const nextIdeas: Record<string, ProjectedLabel> = {};
        for (let idx = 0; idx < bubbleCount; idx++) {
          const id = curIdeas[idx]?.id ?? `demo-${idx}`;
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

      {ideas.length === 0 &&
        (["violet", "slate", "blue", "gold"] as const).map((tone, idx) => {
          const pos = projectedIdeas[`demo-${idx}`];
          if (!pos?.visible) return null;
          return (
            <div
              key={`demo-${idx}`}
              className={`stage-chip stage-chip--${tone}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              aria-hidden="true"
            >
              {tone === "gold" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
                </svg>
              ) : (
                <span className="stage-chip__dots">•••</span>
              )}
            </div>
          );
        })}

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

      {coBuilders.map((b) => {
        const pos = projectedBuilders[b.login];
        if (!pos?.visible) return null;
        return (
          <div
            key={b.login}
            className="workshop-pin workshop-pin--3d"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            @{b.displayName || b.login} · {b.shipped}×
          </div>
        );
      })}
    </div>
  );
}

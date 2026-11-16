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
 * High-craft 3D Three.js Voxel Workshop matching the twilight diorama mockups:
 * - Twilight sky gradient dome + drifting 3D voxel clouds
 * - UnrealBloomPass HDR glow on Twitch-violet windows, doorway lantern, and embers
 * - Detailed floating island, gabled timber/stone cottage, scaffolding, trees & voxel builders
 * - 360° OrbitControls + 3D-projected live !idea bubbles & Co-Builder flags
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
  const totalShipped = coBuilders.reduce((sum, b) => sum + b.shipped, 0);
  const level = Math.min(4, 1 + totalShipped + (state.stats.rounds > 0 ? 1 : 0));
  const phase = state.round?.phase ?? "idle";

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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x281e3d, 0.018);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 140);
    camera.position.set(13.2, 9.6, 13.8);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.52, 0.45, 0.78);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.42;
    controls.minDistance = 8;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 1.8, 0);

    // Twilight gradient sky dome (deep violet zenith -> dusty mauve -> warm amber horizon)
    const skyGeo = new THREE.SphereGeometry(65, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x16122c) },
        midColor: { value: new THREE.Color(0x4b2f69) },
        horizonColor: { value: new THREE.Color(0xdc9872) },
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
          float h = normalize(vWorldPosition).y;
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.15, 0.22, h));
          col = mix(col, topColor, smoothstep(0.18, 0.72, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Lighting
    scene.add(new THREE.HemisphereLight(0xc7a3ff, 0x261e38, 1.05));

    const sun = new THREE.DirectionalLight(0xffcb96, 2.2);
    sun.position.set(12, 15, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 42;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x8c5cff, 0.9);
    rimLight.position.set(-10, 6, -10);
    scene.add(rimLight);

    const crystalLight = new THREE.PointLight(0x9146ff, 5.5, 11);
    crystalLight.position.set(0, 2.8, 0.5);
    scene.add(crystalLight);

    const lanternLight = new THREE.PointLight(0xffb44c, 4.2, 7.5);
    lanternLight.position.set(0.7, 1.4, 2.6);
    scene.add(lanternLight);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const boxGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x67657a, roughness: 0.86 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x3f3a4f, roughness: 0.92 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x523f35, roughness: 0.94 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4b8758, roughness: 0.8 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2f6841, roughness: 0.82 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8f5b36, roughness: 0.78 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x573722, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2b2d3e, roughness: 0.7 });
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xeadcf2, roughness: 0.95, transparent: true, opacity: 0.82 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xd9b8ff,
      emissive: 0x9146ff,
      emissiveIntensity: 2.3,
      roughness: 0.2,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe4a3,
      emissive: 0xffa62b,
      emissiveIntensity: 2.5,
      roughness: 0.15,
    });

    // 1. Sculpted 9x9 floating island base + rocky taper + hanging roots
    const grassSpecs: VoxelSpec[] = [];
    const dirtSpecs: VoxelSpec[] = [];
    const underSpecs: VoxelSpec[] = [];
    const pathSpecs: VoxelSpec[] = [];

    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) {
        const dist = Math.abs(x) + Math.abs(z);
        if (dist > 6) continue;
        const isPath = x === 0 && z >= 2 && z <= 4;
        if (isPath) {
          pathSpecs.push({ x, y: 0.05, z, sx: 0.85, sy: 0.95, sz: 0.85 });
        } else {
          grassSpecs.push({ x, y: 0, z });
        }
        if (dist <= 5) dirtSpecs.push({ x, y: -1, z });
        if (dist <= 3) underSpecs.push({ x, y: -2, z });
        if (dist <= 2) underSpecs.push({ x, y: -3, z });
      }
    }
    underSpecs.push({ x: 0, y: -4, z: 0 }, { x: -1, y: -4, z: 0 }, { x: 0, y: -5, z: 0 });
    // Hanging roots
    dirtSpecs.push(
      { x: -3, y: -1.6, z: 1, sx: 0.25, sy: 1.4, sz: 0.25 },
      { x: 2, y: -2.5, z: 2, sx: 0.25, sy: 1.8, sz: 0.25 },
      { x: -1, y: -3.6, z: -2, sx: 0.22, sy: 1.5, sz: 0.22 },
    );

    islandGroup.add(buildVoxelInstances(boxGeo, grassMat, grassSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneMat, pathSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, dirtMat, dirtSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkStoneMat, underSpecs));

    // 2. Detailed Gabled Workshop Cottage (stone walls, timber corner posts, glowing purple windows)
    const wallSpecs: VoxelSpec[] = [];
    const timberSpecs: VoxelSpec[] = [];
    const windowSpecs: VoxelSpec[] = [];

    for (let y = 1; y <= 2; y++) {
      for (let x = -1.5; x <= 1.5; x += 1) {
        for (let z = -1.5; z <= 1.5; z += 1) {
          const isCorner = Math.abs(x) === 1.5 && Math.abs(z) === 1.5;
          const isWin = y === 1 && ((x === -1.5 && Math.abs(z) < 1) || (z === 1.5 && Math.abs(x) < 1));
          const isDoor = y === 1 && x === 0.5 && z === 1.5;
          if (isDoor) continue;
          if (isWin) windowSpecs.push({ x, y, z });
          else if (isCorner) timberSpecs.push({ x, y, z });
          else wallSpecs.push({ x, y, z });
        }
      }
    }
    // Front stone steps & porch
    wallSpecs.push({ x: 0.5, y: 0.55, z: 2.3, sx: 1.3, sy: 0.45, sz: 0.8 });
    // Door
    timberSpecs.push({ x: 0.5, y: 1.15, z: 1.4, sx: 0.9, sy: 1.3, sz: 0.25 });
    // Dormer crystal window
    windowSpecs.push({ x: 0, y: 3.7, z: 1.1, sx: 0.75, sy: 0.75, sz: 0.75 });
    // Stone chimney
    wallSpecs.push({ x: -1.3, y: 3.5, z: -1.1, sx: 0.7, sy: 2.2, sz: 0.7 });
    // Fence posts & flower/bush tufts around terrace
    timberSpecs.push(
      { x: 1.4, y: 0.75, z: 2.8, sx: 0.2, sy: 0.6, sz: 0.2 },
      { x: -0.6, y: 0.75, z: 2.8, sx: 0.2, sy: 0.6, sz: 0.2 },
    );
    grassSpecs.push(
      { x: 1.5, y: 0.65, z: 3.3, sx: 0.55, sy: 0.45, sz: 0.55 },
      { x: -1.8, y: 0.65, z: 3.2, sx: 0.6, sy: 0.48, sz: 0.6 },
    );

    islandGroup.add(buildVoxelInstances(boxGeo, stoneMat, wallSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkWoodMat, timberSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, crystalMat, windowSpecs, false, false));

    // 3. Stepped pitched slate roof
    const roofSpecs: VoxelSpec[] = [];
    for (let z = -2; z <= 2; z++) {
      for (let x = -2; x <= 2; x++) {
        roofSpecs.push({ x, y: 3, z, sx: 0.95, sy: 0.65, sz: 0.95 });
      }
      for (let x = -1; x <= 1; x++) {
        roofSpecs.push({ x, y: 3.65, z, sx: 0.95, sy: 0.65, sz: 0.95 });
      }
      roofSpecs.push({ x: 0, y: 4.3, z, sx: 0.95, sy: 0.65, sz: 0.95 });
    }
    islandGroup.add(buildVoxelInstances(boxGeo, roofMat, roofSpecs));

    // 4. Right-side multi-level scaffolding, crane & crates
    const scaffSpecs: VoxelSpec[] = [
      { x: 2.6, y: 1.2, z: -0.6, sx: 0.2, sy: 2.2, sz: 0.2 },
      { x: 2.6, y: 1.2, z: 1.0, sx: 0.2, sy: 2.2, sz: 0.2 },
      { x: 3.5, y: 1.2, z: -0.6, sx: 0.2, sy: 2.2, sz: 0.2 },
      { x: 3.5, y: 1.2, z: 1.0, sx: 0.2, sy: 2.2, sz: 0.2 },
      { x: 3.05, y: 2.1, z: 0.2, sx: 1.25, sy: 0.16, sz: 1.9 },
      { x: 3.05, y: 3.1, z: 0.2, sx: 0.2, sy: 1.8, sz: 0.2 },
      { x: 2.5, y: 3.9, z: 0.2, sx: 1.3, sy: 0.18, sz: 0.2 },
      // Crates
      { x: 2.6, y: 0.85, z: 2.1, sx: 0.65, sy: 0.65, sz: 0.65 },
      { x: 3.2, y: 0.75, z: 1.8, sx: 0.5, sy: 0.5, sz: 0.5 },
    ];
    islandGroup.add(buildVoxelInstances(boxGeo, woodMat, scaffSpecs));

    // 5. Lush layered pine trees (left & back)
    const trunkSpecs: VoxelSpec[] = [
      { x: -3.0, y: 1.0, z: -1.2, sx: 0.45, sy: 1.3, sz: 0.45 },
      { x: -2.6, y: 1.0, z: 1.8, sx: 0.42, sy: 1.1, sz: 0.42 },
      { x: 1.6, y: 1.0, z: -3.0, sx: 0.42, sy: 1.2, sz: 0.42 },
    ];
    islandGroup.add(buildVoxelInstances(boxGeo, darkWoodMat, trunkSpecs));

    const pineSpecs: VoxelSpec[] = [
      // Tree 1
      { x: -3.0, y: 2.0, z: -1.2, sx: 1.5, sy: 0.8, sz: 1.5 },
      { x: -3.0, y: 2.75, z: -1.2, sx: 1.1, sy: 0.8, sz: 1.1 },
      { x: -3.0, y: 3.45, z: -1.2, sx: 0.65, sy: 0.75, sz: 0.65 },
      // Tree 2
      { x: -2.6, y: 1.9, z: 1.8, sx: 1.35, sy: 0.75, sz: 1.35 },
      { x: -2.6, y: 2.6, z: 1.8, sx: 0.85, sy: 0.75, sz: 0.85 },
      // Tree 3
      { x: 1.6, y: 1.95, z: -3.0, sx: 1.4, sy: 0.75, sz: 1.4 },
      { x: 1.6, y: 2.65, z: -3.0, sx: 0.9, sy: 0.75, sz: 0.9 },
    ];
    islandGroup.add(buildVoxelInstances(boxGeo, pineMat, pineSpecs));

    // Doorway lantern + garden lanterns
    islandGroup.add(
      buildVoxelInstances(
        boxGeo,
        lanternMat,
        [
          { x: 1.1, y: 1.45, z: 1.9, sx: 0.28, sy: 0.36, sz: 0.28 },
          { x: -0.9, y: 0.8, z: 3.1, sx: 0.26, sy: 0.34, sz: 0.26 },
          // Pulley bucket hanging from right crane + terrace flower highlights
          { x: 2.1, y: 3.1, z: 0.2, sx: 0.35, sy: 0.35, sz: 0.35 },
          { x: -2.2, y: 0.62, z: 2.8, sx: 0.18, sy: 0.18, sz: 0.18 },
          { x: 1.4, y: 0.62, z: 3.5, sx: 0.18, sy: 0.18, sz: 0.18 },
        ],
        false,
        false,
      ),
    );

    // Distant floating background voxel islands for 3D depth parallax
    const bgIslands = new THREE.Group();
    const bgGrass: VoxelSpec[] = [
      { x: -12, y: 2.2, z: -14, sx: 3.2, sy: 0.7, sz: 3.2 },
      { x: 14, y: 1.2, z: -15, sx: 2.6, sy: 0.6, sz: 2.6 },
    ];
    const bgRock: VoxelSpec[] = [
      { x: -12, y: 1.3, z: -14, sx: 2.2, sy: 1.4, sz: 2.2 },
      { x: -12, y: 0.2, z: -14, sx: 1.1, sy: 1.1, sz: 1.1 },
      { x: 14, y: 0.4, z: -15, sx: 1.8, sy: 1.1, sz: 1.8 },
    ];
    const bgTree: VoxelSpec[] = [
      { x: -12.4, y: 3.2, z: -14.2, sx: 1.1, sy: 1.5, sz: 1.1 },
      { x: 14.2, y: 2.1, z: -15.1, sx: 0.9, sy: 1.2, sz: 0.9 },
    ];
    bgIslands.add(buildVoxelInstances(boxGeo, grassMat, bgGrass, false, false));
    bgIslands.add(buildVoxelInstances(boxGeo, darkStoneMat, bgRock, false, false));
    bgIslands.add(buildVoxelInstances(boxGeo, pineMat, bgTree, false, false));
    scene.add(bgIslands);

    // 6. Voxel Builder avatars standing on the terrace
    const builderHeads: VoxelSpec[] = [
      { x: -1.2, y: 1.35, z: 2.4, sx: 0.42, sy: 0.42, sz: 0.42 },
      { x: 1.8, y: 1.35, z: 2.5, sx: 0.42, sy: 0.42, sz: 0.42 },
      { x: 3.0, y: 2.75, z: 0.2, sx: 0.42, sy: 0.42, sz: 0.42 },
    ];
    const builderBodies: VoxelSpec[] = [
      { x: -1.2, y: 0.9, z: 2.4, sx: 0.44, sy: 0.55, sz: 0.35 },
      { x: 1.8, y: 0.9, z: 2.5, sx: 0.44, sy: 0.55, sz: 0.35 },
      { x: 3.0, y: 2.35, z: 0.2, sx: 0.44, sy: 0.55, sz: 0.35 },
    ];
    islandGroup.add(buildVoxelInstances(boxGeo, lanternMat, builderHeads));
    islandGroup.add(buildVoxelInstances(boxGeo, crystalMat, builderBodies));

    // 7. Drifting 3D voxel cloud clusters around the island
    const cloudsGroup = new THREE.Group();
    const cloudSpecs: VoxelSpec[] = [
      { x: -9, y: 3.5, z: -7, sx: 2.4, sy: 1.1, sz: 1.8 },
      { x: -7.6, y: 4.1, z: -7, sx: 1.5, sy: 0.9, sz: 1.4 },
      { x: 9.5, y: 4.4, z: -5, sx: 2.6, sy: 1.1, sz: 1.8 },
      { x: 10.6, y: 5.0, z: -5, sx: 1.4, sy: 0.85, sz: 1.4 },
      { x: -8, y: -1.5, z: 8, sx: 2.8, sy: 1.0, sz: 2.0 },
    ];
    cloudsGroup.add(buildVoxelInstances(boxGeo, cloudMat, cloudSpecs, false, false));
    scene.add(cloudsGroup);

    // Floating glowing ember motes
    const moteCount = 48;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 14;
      motePos[i * 3 + 1] = Math.random() * 8 - 2;
      motePos[i * 3 + 2] = (Math.random() - 0.5) * 14;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({ color: 0xd8bfff, size: 0.16, transparent: true, opacity: 0.85 });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // Rising voxel chimney smoke puffs
    const smokeGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0xc9c2dc, transparent: true, opacity: 0.42, roughness: 1 });
    const smokePuffs = Array.from({ length: 5 }, (_, i) => {
      const m = new THREE.Mesh(smokeGeo, smokeMat);
      m.position.set(-1.3, 4.8 + i * 0.65, -1.1);
      islandGroup.add(m);
      return { mesh: m, offset: i * 0.2 };
    });

    // 3D Firework particle cubes
    const bursts: BurstCube[] = [];
    const burstGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    burstFnRef.current = (colorHex: number) => {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 2.2 });
      for (let i = 0; i < 20; i++) {
        const mesh = new THREE.Mesh(burstGeo, mat);
        mesh.position.set(0, 4.5, 0);
        scene.add(mesh);
        const ang = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 0.06 + Math.random() * 0.09;
        bursts.push({
          mesh,
          vx: Math.cos(ang) * spd,
          vy: 0.11 + Math.random() * 0.09,
          vz: Math.sin(ang) * spd,
          life: 50,
        });
      }
    };

    const ideaAnchors = [
      new THREE.Vector3(-2.6, 4.1, 1.8),
      new THREE.Vector3(2.8, 4.4, 1.0),
      new THREE.Vector3(-2.0, 4.8, -2.0),
      new THREE.Vector3(2.0, 3.8, -2.2),
    ];
    const builderAnchors = [
      new THREE.Vector3(-1.2, 1.8, 2.4),
      new THREE.Vector3(1.8, 1.8, 2.5),
      new THREE.Vector3(3.0, 3.2, 0.2),
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
      islandGroup.position.y = Math.sin(t * 1.05) * 0.12;
      cloudsGroup.position.x = Math.sin(t * 0.18) * 0.6;
      crystalLight.intensity = 5.0 + Math.sin(t * 3.0) * 0.9;

      for (const puff of smokePuffs) {
        const cyc = (t * 0.45 + puff.offset) % 1;
        puff.mesh.position.y = 4.7 + cyc * 2.4;
        puff.mesh.position.x = -1.3 + Math.sin(t + puff.offset * 6) * 0.15;
        puff.mesh.scale.setScalar(0.7 + cyc * 0.8);
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
          curIdeas.forEach((idea, idx) => {
            vec.copy(ideaAnchors[idx % ideaAnchors.length]!);
            vec.y += islandGroup.position.y;
            vec.project(camera);
            nextIdeas[idea.id] = {
              id: idea.id,
              x: (vec.x * 0.5 + 0.5) * 100,
              y: (-vec.y * 0.5 + 0.5) * 100,
              visible: vec.z < 1,
            };
          });
          setProjectedIdeas(nextIdeas);
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

      <div className="workshop-hud">
        <span>3D VOXEL // LVL 0{level}</span>
        <span>PHASE // {phase.toUpperCase()}</span>
        <span>DRAG TO ORBIT</span>
      </div>

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

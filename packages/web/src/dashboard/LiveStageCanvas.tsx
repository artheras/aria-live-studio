import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { LiveState } from "@aria-live/shared";
import { truncate } from "../lib/time";
import { buildVoxelInstances, type VoxelSpec } from "./stage/voxels";
import { createStageDraft } from "./stage/draft";
import { fillIslandBase } from "./stage/islandBase";
import { computeBallot } from "../lib/round";
import { villageLoop } from "./stage/routes";
import { playCue } from "../lib/sound";

interface BurstCube {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
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
  const cameraGoalRef = useRef<{ pos: [number, number, number]; target: [number, number, number] } | null>(null);

  useEffect(() => {
    const nextPhase = state.round?.phase ?? "idle";
    if (!compact && nextPhase !== prevPhaseRef.current) {
      const presets: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
        idle: { pos: [27.6, 11.2, 28.4], target: [0.0, -2.2, 0.2] },
        collecting: { pos: [22.5, 9.6, 25.2], target: [-1.8, -1.5, 2.2] },
        voting: { pos: [24.2, 13.8, 24.6], target: [0.4, -2.0, 0.8] },
        planning: { pos: [21.0, 10.2, 22.8], target: [1.6, -1.2, -1.0] },
        awaiting_approval: { pos: [21.0, 10.2, 22.8], target: [1.6, -1.2, -1.0] },
        executing: { pos: [19.4, 9.0, 21.5], target: [1.2, -0.8, -1.4] },
        done: { pos: [28.4, 11.8, 29.2], target: [0.0, -2.0, 0.0] },
      };
      cameraGoalRef.current = presets[nextPhase] ?? presets.idle!;
    }
    prevPhaseRef.current = nextPhase;
  }, [state.round?.phase, compact]);

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
    scene.fog = new THREE.Fog(0x1f1147, 68, 150);

    // Full-Island Diorama 3/4 view framing the central Clockwork Spire, terraced village & deep crystal roots.
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 240);
    camera.position.set(compact ? 34.2 : 27.6, compact ? 14.0 : 11.2, compact ? 35.2 : 28.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controls.minDistance = 6.5;
    controls.maxDistance = 54;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0.0, compact ? -1.6 : -2.2, 0.2);
    const onControlStart = () => {
      cameraGoalRef.current = null;
    };
    controls.addEventListener("start", onControlStart);

    // Deep Indigo-to-Royal-Violet Night Sky Dome matching the reference starfield atmosphere
    const skyGeo = new THREE.SphereGeometry(92, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0b0521) },
        midColor: { value: new THREE.Color(0x1c1046) },
        horizonColor: { value: new THREE.Color(0x371f6e) },
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
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.45, 0.02, h));
          col = mix(col, topColor, smoothstep(0.02, 0.38, h));
          float underGlow = pow(max(1.0 - abs(h + 0.18) * 2.6, 0.0), 2.2);
          col = mix(col, vec3(0.32, 0.16, 0.58), underGlow * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    if (!transparent) {
      scene.add(new THREE.Mesh(skyGeo, skyMat));
    }

    // Moody Twilight Starlight vs. Warm Amber Hearth & Under-Island Amethyst Rim Lighting
    const hemi = new THREE.HemisphereLight(0xa38ef0, 0x2c1b52, 1.05);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffdfb8, 2.45);
    sun.position.set(9, 14, 15);
    const fill = new THREE.DirectionalLight(0x8b6fd6, 0.85);
    fill.position.set(-8, 6, 9);
    scene.add(fill);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 56;
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const porchLight = new THREE.PointLight(0xff9e32, 3.0, 13.0);
    porchLight.position.set(-5.6, 2.4, 7.6);
    const hallLight = new THREE.PointLight(0xffa838, 3.5, 14.5);
    hallLight.position.set(0.2, 3.6, 2.2);
    const eastLight = new THREE.PointLight(0xff9828, 2.8, 12.5);
    eastLight.position.set(7.4, 2.4, 5.4);
    const underLightL = new THREE.PointLight(0xd946ef, 4.2, 20.0);
    underLightL.position.set(-5.6, -5.8, 6.8);
    const underLightR = new THREE.PointLight(0xa855f7, 4.2, 20.0);
    underLightR.position.set(5.6, -5.8, 6.8);
    scene.add(porchLight, hallLight, eastLight, underLightL, underLightR);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const voxelGeo = new RoundedBoxGeometry(0.472, 0.472, 0.472, 2, 0.042);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0x4c357d,
      roughness: 0.88,
      transparent: true,
      opacity: 0.78,
    });
    const clouds: THREE.Group[] = [];
    for (const [cx, cy, cz] of [
      [-18.5, 5.2, -7.5],
      [18.2, 4.0, -6.5],
      [-19.0, -4.2, 5.5],
      [18.5, -4.8, 5.2],
    ] as const) {
      const puff = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const cube = new THREE.Mesh(voxelGeo, cloudMat);
        cube.position.set(i * 0.72 - 1, (i % 2) * 0.28, (i % 3) * 0.12);
        cube.scale.set(1.75, 0.65, 0.95);
        puff.add(cube);
      }
      puff.position.set(cx, cy, cz);
      scene.add(puff);
      clouds.push(puff);
    }
    const stoneLightMat = new THREE.MeshStandardMaterial({ color: 0x7a7387, roughness: 0.82 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xf5d0fe,
      emissive: 0xc026d3,
      emissiveIntensity: 2.2,
      roughness: 0.18,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe49e,
      emissive: 0xff9818,
      emissiveIntensity: 2.1,
      roughness: 0.24,
    });

    const islandBase = createStageDraft(voxelGeo);
    fillIslandBase(islandBase);
    islandBase.mount(islandGroup);

    const buildings = new THREE.Group();
    islandGroup.add(buildings);
    let disposed = false;

    const houseLoader = new GLTFLoader();
    const placeGlb = (url: string, x: number, y: number, z: number, rot: number, scale: number) => {
      houseLoader.load(url, (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.position.set(x, y, z);
        model.rotation.y = rot;
        model.scale.setScalar(scale);
        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
          if (obj.name === "Gear") workshopGears.push(obj);
        });
        buildings.add(model);
      });
    };
    placeGlb("/models/cottage-garden.glb?v=13", -6.2, 0.5, 7.0, 0, 1.56);
    placeGlb("/models/cottage-timber.glb?v=13", 6.8, 0.5, 6.6, 0, 1.52);
    placeGlb("/models/cottage-lantern.glb?v=13", -10.0, 0.96, -0.2, Math.PI / 2, 1.55);
    placeGlb("/models/cottage-stone.glb?v=13", 10.6, 0.65, 0.2, 0, 1.55);
    placeGlb("/models/cottage-violet.glb?v=13", -3.8, 0.96, -9.0, 0, 1.55);
    placeGlb("/models/cottage-hearth.glb?v=13", 5.8, 0.65, -9.0, 0, 1.55);
    const workshopGears: THREE.Object3D[] = [];
    placeGlb("/models/workshop.glb?v=13", 0.15, 1.62, -1.4, 0, 1.75);

    // 2D circular obstacle colliders for all 7 buildings + foreground structures so engineers steer around walls
    const buildingColliders: ReadonlyArray<{ x: number; z: number; r: number }> = [
      { x: -6.2, z: 7.0, r: 2.55 },   // cottage-garden
      { x: 6.8, z: 6.6, r: 2.55 },    // cottage-timber
      { x: -10.0, z: -0.2, r: 2.55 }, // cottage-lantern
      { x: 10.6, z: 0.2, r: 2.55 },   // cottage-stone
      { x: -3.8, z: -9.0, r: 2.55 },  // cottage-violet
      { x: 5.8, z: -9.0, r: 2.55 },   // cottage-hearth
      { x: 0.15, z: -1.4, r: 3.45 },  // central workshop
      { x: -2.1, z: 12.3, r: 1.15 },  // ballot obelisk
      { x: 4.45, z: 10.2, r: 1.15 },  // blueprint gazebo
    ];

    // Chimney voxel smoke particle pool for Central Workshop & Hearth Cottage
    type SmokePuff = { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; vx: number; vy: number; vz: number; life: number; maxLife: number };
    const smokePuffs: SmokePuff[] = [];
    const spawnSmoke = (ox: number, oy: number, oz: number) => {
      if (smokePuffs.length > 26) return;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd8ccf2,
        emissive: 0x6d4aa8,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.5,
        roughness: 0.9,
      });
      const mesh = new THREE.Mesh(voxelGeo, mat);
      mesh.position.set(ox + (Math.random() - 0.5) * 0.22, oy, oz + (Math.random() - 0.5) * 0.22);
      mesh.scale.setScalar(0.32);
      islandGroup.add(mesh);
      smokePuffs.push({
        mesh,
        mat,
        vx: (Math.random() - 0.5) * 0.22 + 0.14,
        vy: 0.72 + Math.random() * 0.28,
        vz: (Math.random() - 0.5) * 0.18,
        life: 0,
        maxLife: 2.6 + Math.random() * 0.9,
      });
    };

    // Dynamic MCP Relay Beacon crystal + rising pulse ring
    const mcpCrystalMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0x7e22ce,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    const mcpCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), mcpCrystalMat);
    mcpCrystal.position.set(2.7, 2.15, 3.6);
    const troughWater = new THREE.Mesh(
      voxelGeo,
      new THREE.MeshStandardMaterial({
        color: 0x7ec8c3,
        emissive: 0x2a6d78,
        emissiveIntensity: 0.35,
        roughness: 0.18,
        transparent: true,
        opacity: 0.85,
      }),
    );
    troughWater.scale.set(0.85, 0.16, 0.32);
    troughWater.position.set(7.9, 0.42, 9.75);
    islandGroup.add(troughWater);
    const mcpRingMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const mcpRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 16), mcpRingMat);
    mcpRing.rotation.x = -Math.PI / 2;
    mcpRing.position.set(2.7, 1.7, 3.6);
    islandGroup.add(mcpCrystal, mcpRing);

    const letterMat = new THREE.MeshStandardMaterial({
      color: 0xfff6e4,
      emissive: 0xffc56a,
      emissiveIntensity: 0.35,
      roughness: 0.45,
    });
    const letter = new THREE.Mesh(voxelGeo, letterMat);
    letter.scale.set(0.72, 0.48, 0.1);
    letter.position.set(-8.0, 1.48, 10.74);
    const planSheetMat = new THREE.MeshStandardMaterial({
      color: 0xf4efe4,
      emissive: 0xc9b8ff,
      emissiveIntensity: 0.15,
      roughness: 0.55,
    });
    const planSheet = new THREE.Mesh(voxelGeo, planSheetMat);
    planSheet.scale.set(1.2, 0.08, 0.72);
    planSheet.position.set(4.45, 1.02, 10.2);
    planSheet.rotation.y = 0.2;
    const stallGearMat = new THREE.MeshStandardMaterial({
      color: 0xe7b84a,
      emissive: 0xc4842a,
      emissiveIntensity: 0.35,
      metalness: 0.4,
      roughness: 0.35,
    });
    const stallGear = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 6, 10), stallGearMat);
    stallGear.position.set(9.9, 1.9, 9.95);
    const wellWater = new THREE.Mesh(
      voxelGeo,
      new THREE.MeshStandardMaterial({
        color: 0x6eb8c9,
        emissive: 0x1d6a86,
        emissiveIntensity: 0.45,
        roughness: 0.15,
        transparent: true,
        opacity: 0.88,
      }),
    );
    wellWater.scale.set(0.7, 0.12, 0.7);
    wellWater.position.set(-7.8, 0.78, -11.6);
    const scaffold = new THREE.Group();
    const scaffoldWood = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.84 });
    const scaffoldPlank = (x: number, y: number, z: number, sx: number, sy: number, sz: number, parent = scaffold) => {
      const plank = new THREE.Mesh(voxelGeo, scaffoldWood);
      plank.position.set(x, y, z);
      plank.scale.set(sx, sy, sz);
      parent.add(plank);
    };
    scaffoldPlank(2.55, 1.05, 1.2, 0.2, 3.6, 0.2);
    scaffoldPlank(3.4, 1.05, 1.2, 0.2, 3.6, 0.2);
    scaffoldPlank(2.98, 1.55, 1.2, 1.25, 0.14, 0.72);
    const scaffoldExtra = new THREE.Group();
    scaffoldPlank(2.55, 1.7, 0.55, 0.16, 2.4, 0.16, scaffoldExtra);
    scaffoldPlank(3.4, 1.7, 0.55, 0.16, 2.4, 0.16, scaffoldExtra);
    scaffoldPlank(2.98, 2.35, 0.85, 1.3, 0.12, 0.85, scaffoldExtra);
    scaffold.add(scaffoldExtra);
    const siteCrates = new THREE.Group();
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xa86b3c, roughness: 0.86 });
    for (const [x, y, z, s] of [
      [3.7, 0.38, 1.7, 0.72],
      [4.15, 0.48, 1.35, 0.55],
      [3.85, 0.95, 1.55, 0.42],
    ] as const) {
      const crate = new THREE.Mesh(voxelGeo, crateMat);
      crate.position.set(x, y, z);
      crate.scale.set(s, s, s);
      siteCrates.add(crate);
    }
    scaffold.add(siteCrates);
    scaffold.visible = false;
    const towerCapMat = new THREE.MeshStandardMaterial({
      color: 0xf0dbff,
      emissive: 0xc084fc,
      emissiveIntensity: 0.4,
      roughness: 0.2,
    });
    const towerCap = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), towerCapMat);
    towerCap.position.set(3.78, 4.7, 4.2);
    islandGroup.add(letter, planSheet, stallGear, wellWater, scaffold, towerCap);

    // Dynamic Live Ballot & Idea Totem bars (4 glowing columns scaled by ideas/votes)
    const ballotBarMats = [0xa855f7, 0x38bdf8, 0x34d399, 0xfbbf24].map(
      (hex) =>
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.45,
          roughness: 0.3,
        }),
    );
    const ballotBars = ballotBarMats.map((mat, i) => {
      const m = new THREE.Mesh(voxelGeo, mat);
      m.scale.set(0.55, 0.5, 0.28);
      m.position.set(-3.0 + i * 0.6, 0.95, 12.68);
      islandGroup.add(m);
      return m;
    });

    // 8. Villagers on the garden path. Clicking one makes that person hop.
    type LimbActor = {
      group: THREE.Group;
      base: THREE.Vector3;
      waypoints: THREE.Vector3[];
      wpIdx: number;
      phase: number;
      hopUntil: number;
      vx: number;
      vz: number;
      stridePhase: number;
      walkBlend: number;
      head: THREE.Object3D;
      leftLeg: THREE.Object3D;
      rightLeg: THREE.Object3D;
      leftArm: THREE.Object3D;
      rightArm: THREE.Object3D;
      glowMats: THREE.MeshStandardMaterial[];
    };
    const villagers: LimbActor[] = [];
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6cba8, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2820, roughness: 0.84 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.86 });
    const addVillager = (
      x: number,
      y: number,
      z: number,
      shirt: number,
      hat: number,
      rotY: number,
      phase: number,
      waypoints: THREE.Vector3[],
    ) => {
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
      shoeL.scale.set(1.16, 0.22, 1.3);
      shoeL.position.set(0, -0.42, 0.12);
      leftLeg.add(shoeL);
      const shoeR = shoeL.clone();
      rightLeg.add(shoeR);
      g.add(head, hair, cap, body, leftLeg, rightLeg, leftArm, rightArm, eyeL, eyeR);
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      g.scale.setScalar(1.22);
      islandGroup.add(g);
      villagers.push({
        group: g,
        base: new THREE.Vector3(x, y, z),
        waypoints,
        wpIdx: 0,
        phase,
        hopUntil: 0,
        vx: 0,
        vz: 0,
        stridePhase: phase,
        walkBlend: 0,
        head,
        leftLeg,
        rightLeg,
        leftArm,
        rightArm,
        glowMats: [],
      });
    };
    const loopPts = villageLoop.map(([x, z]) => new THREE.Vector3(x, 0.08, z));
    const ringFrom = (start: number, dir: 1 | -1) => {
      const n = loopPts.length;
      return Array.from({ length: n }, (_, k) => loopPts[(start + dir * k + n * 4) % n]!);
    };
    const outfits: Array<[number, number, number]> = [
      [0x6d28d9, 0x4c1d95, 0.2],
      [0x0284c7, 0x0369a1, 1.4],
      [0x059669, 0x047857, 2.6],
      [0xd97706, 0xb45309, 3.8],
    ];
    const patrols: Array<[number, 1 | -1]> = [
      [0, 1],
      [3, 1],
      [6, 1],
      [14, 1],
    ];
    outfits.forEach(([shirt, hat, phase], idx) => {
      const [start, dir] = patrols[idx]!;
      const pts = ringFrom(start, dir);
      const p = pts[0]!;
      addVillager(p.x, 0.08, p.z, shirt, hat, dir > 0 ? 0.4 : -0.4, phase, pts);
    });

    // Upgrade villagers with the 1:1 Aria Voxel Engineer GLB model (distinct role colors, articulated joints & tools)
    const toolRoles: Array<"hammer" | "wrench" | "tablet" | "hammer"> = ["hammer", "wrench", "tablet", "hammer"];
    const rolePalettes = [
      { suitDark: 0x4c1d95, suitMid: 0x6d28d9, suitLight: 0x8b5cf6, trim: 0xddd6fe, glow: 0xa855f7 }, // 0: Scout (Royal Violet)
      { suitDark: 0x0369a1, suitMid: 0x0284c7, suitLight: 0x38bdf8, trim: 0xe0f2fe, glow: 0x38bdf8 }, // 1: Teller (Cobalt Sky Blue)
      { suitDark: 0x047857, suitMid: 0x059669, suitLight: 0x10b981, trim: 0xd1fae5, glow: 0x10b981 }, // 2: Planner (Emerald Green)
      { suitDark: 0xb45309, suitMid: 0xd97706, suitLight: 0xf59e0b, trim: 0xfef3c7, glow: 0xf59e0b }, // 3: Builder (Amber Gold-Orange)
    ] as const;
    new GLTFLoader().load(
      "/models/aria-engineer.glb",
      (gltf) => {
        if (disposed) return;
        villagers.forEach((v, idx) => {
          const clone = gltf.scene.clone(true);
          const pal = rolePalettes[idx % rolePalettes.length]!;
          const glowMats: THREE.MeshStandardMaterial[] = [];
          clone.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              const recolorMat = (orig: THREE.Material): THREE.Material => {
                const m = orig.clone() as THREE.MeshStandardMaterial;
                if (m.color) {
                  const c = m.color;
                  const isSuit = c.b > 0.35 && c.b > c.r * 1.8 && c.b > c.g * 3.0;
                  const isTrim = c.b > 0.9 && c.r > 0.65 && c.b > c.g * 1.2;
                  if (isSuit) {
                    if (c.b < 0.58) m.color.setHex(pal.suitDark);
                    else if (c.b < 0.77) m.color.setHex(pal.suitMid);
                    else m.color.setHex(pal.suitLight);
                  } else if (isTrim) {
                    m.color.setHex(pal.trim);
                    if (m.emissive) {
                      m.emissive.setHex(pal.glow);
                      glowMats.push(m);
                    }
                  }
                }
                return m;
              };
              mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map(recolorMat)
                : recolorMat(mesh.material);
            }
          });
          const role = toolRoles[idx % toolRoles.length];
          const hammer = clone.getObjectByName("ToolHammer");
          const wrench = clone.getObjectByName("ToolWrench");
          const tablet = clone.getObjectByName("ToolTablet");
          if (hammer) hammer.visible = role === "hammer";
          if (wrench) wrench.visible = role === "wrench";
          if (tablet) tablet.visible = role === "tablet";

          // Role indicator ring at feet + glowing helmet crest badge to distinguish the 4 engineers
          const badgeMat = new THREE.MeshStandardMaterial({
            color: pal.suitMid,
            emissive: pal.glow,
            emissiveIntensity: 0.85,
            roughness: 0.25,
          });
          const footRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 20), badgeMat);
          footRing.rotation.x = -Math.PI / 2;
          footRing.position.y = 0.03;
          const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), badgeMat);
          crest.position.set(0, 1.48, 0);
          glowMats.push(badgeMat);

          v.group.clear();
          v.group.add(clone, footRing, crest);
          v.group.scale.setScalar(1.42);
          v.head = clone.getObjectByName("Head") ?? v.head;
          v.leftLeg = clone.getObjectByName("LegL") ?? v.leftLeg;
          v.rightLeg = clone.getObjectByName("LegR") ?? v.rightLeg;
          v.leftArm = clone.getObjectByName("ArmL") ?? v.leftArm;
          v.rightArm = clone.getObjectByName("ArmR") ?? v.rightArm;
          v.glowMats = glowMats;
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
        [-8.6, 0.35, 4.4],
        [9.2, 0.35, 4.2],
        [-8.8, 0.35, -2.4],
        [8.6, 0.35, -6.2],
        [-8.4, 0.35, -6.6],
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
    const foxLegs = [foxLeg(-0.22, 0.28), foxLeg(0.22, 0.28), foxLeg(-0.22, -0.22), foxLeg(0.22, -0.22)];
    fox.add(foxBody, foxChest, foxHead, foxEarL, foxEarR, foxTail, foxTip, ...foxLegs);
    // Dedicated West & South-West foreground woodland lawn loop (100% visible & clear of house pads)
    const foxRoute = [
      new THREE.Vector3(-5.2, 0.08, 11.6),
      new THREE.Vector3(-9.8, 0.08, 8.8),
      new THREE.Vector3(-11.4, 0.08, 5.2),
      new THREE.Vector3(-7.0, 0.08, 2.2),
      new THREE.Vector3(-6.8, 0.08, -3.2),
      new THREE.Vector3(-7.2, 0.08, 2.2),
      new THREE.Vector3(-10.4, 0.08, 7.6),
    ];
    const foxBase = foxRoute[0]!.clone();
    fox.position.copy(foxBase);
    let foxWp = 1;
    fox.scale.setScalar(1.25);
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
    // Dedicated South-Center & East flower garden lawn loop (100% visible & clear of walkways)
    const henRoute = [
      new THREE.Vector3(1.2, 0.08, 11.8),
      new THREE.Vector3(2.8, 0.08, 11.2),
      new THREE.Vector3(6.6, 0.08, 10.6),
      new THREE.Vector3(11.4, 0.08, 6.8),
      new THREE.Vector3(11.2, 0.08, 4.2),
      new THREE.Vector3(6.6, 0.08, 10.6),
    ];
    const henBase = henRoute[0]!.clone();
    hen.scale.setScalar(1.32);
    hen.position.copy(henBase);
    let henWp = 1;
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
    const birdBase = new THREE.Vector3(-11.8, 3.4, 8.8);
    bird.scale.setScalar(1.7);
    bird.position.copy(birdBase);
    islandGroup.add(bird);
    let birdFlyUntil = 0;

    // 9. Atmospheric Dusk-Violet Voxel Clouds + Pixel Starfield + Falling Under-Island Crystal Streams
    const bgIslands = new THREE.Group();
    const cloudLightMat = new THREE.MeshStandardMaterial({
      color: 0x5c4294,
      roughness: 0.84,
      transparent: true,
      opacity: 0.78,
    });
    const cloudShadeMat = new THREE.MeshStandardMaterial({
      color: 0x3b2669,
      roughness: 0.88,
      transparent: true,
      opacity: 0.82,
    });
    const cloudTopSpecs: VoxelSpec[] = [];
    const cloudBotSpecs: VoxelSpec[] = [];
    const addVoxelCloud = (cx: number, cy: number, cz: number, scale = 1) => {
      const puffs = [
        [0, 0.22, 0, 3.2, 1.15, 2.1],
        [-0.9, 0.1, 0.15, 2.4, 0.95, 1.7],
        [0.95, 0.08, -0.1, 2.4, 0.95, 1.7],
        [-0.35, 0.48, -0.05, 2.0, 0.9, 1.5],
        [0.4, 0.44, 0.1, 1.85, 0.85, 1.4],
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
          y: cy + (dy - 0.24) * scale,
          z: cz + dz * scale,
          sx: sx * 0.98 * scale,
          sy: sy * 0.56 * scale,
          sz: sz * 0.98 * scale,
        });
      }
    };
    addVoxelCloud(-18.2, 3.8, -3.2, 1.4);
    addVoxelCloud(-18.8, -5.2, 6.4, 1.5);
    addVoxelCloud(18.0, 2.2, -5.2, 1.35);
    addVoxelCloud(17.6, -5.8, 5.8, 1.45);
    addVoxelCloud(-14.2, 6.8, -11.5, 1.2);
    addVoxelCloud(14.6, 6.2, -11.2, 1.15);
    bgIslands.add(buildVoxelInstances(voxelGeo, cloudShadeMat, cloudBotSpecs, false, false));
    bgIslands.add(buildVoxelInstances(voxelGeo, cloudLightMat, cloudTopSpecs, false, false));

    // Pixel Voxel Starfield across the deep indigo sky
    const starCount = 220;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const s1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const s2 = Math.sin(i * 93.989 + 47.145) * 24634.6345;
      const u1 = s1 - Math.floor(s1);
      const u2 = s2 - Math.floor(s2);
      starPos[i * 3] = (u1 - 0.5) * 78 - (u2 - 0.5) * 26;
      starPos[i * 3 + 1] = -18 + u2 * 40;
      starPos[i * 3 + 2] = -28 - u1 * 22 + (u2 - 0.5) * 24;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xf5f0ff, size: 0.24, transparent: true, opacity: 0.92 });
    bgIslands.add(new THREE.Points(starGeo, starMat));
    scene.add(bgIslands);

    // Animated Vertical Falling Starlight Stream Motes under the Island's Amethyst Veins
    const streamAnchors: ReadonlyArray<readonly [number, number, number]> = [
      [-12.4, -2.8, 6.8],
      [-10.2, -3.2, 9.8],
      [-7.2, -3.6, 12.2],
      [-3.8, -3.8, 13.6],
      [0.0, -4.0, 14.2],
      [3.8, -3.8, 13.6],
      [7.4, -3.6, 12.0],
      [10.4, -3.2, 9.6],
      [12.8, -2.8, 6.4],
      [-5.8, -5.4, 9.2],
      [-2.2, -5.8, 10.2],
      [2.2, -5.8, 10.0],
      [6.0, -5.4, 8.8],
      [-1.8, -7.8, 6.4],
      [2.0, -7.8, 6.2],
      [0.1, -10.2, 1.2],
    ];
    const streamMoteCount = streamAnchors.length * 10;
    const streamMotePos = new Float32Array(streamMoteCount * 3);
    for (let i = 0; i < streamMoteCount; i++) {
      const a = streamAnchors[i % streamAnchors.length]!;
      const k = Math.floor(i / streamAnchors.length) / 10;
      streamMotePos[i * 3] = a[0] + ((i % 3) - 1) * 0.06;
      streamMotePos[i * 3 + 1] = a[1] - k * 5.6;
      streamMotePos[i * 3 + 2] = a[2] + (((i + 1) % 3) - 1) * 0.06;
    }
    const streamMoteGeo = new THREE.BufferGeometry();
    streamMoteGeo.setAttribute("position", new THREE.BufferAttribute(streamMotePos, 3));
    scene.add(
      new THREE.Points(
        streamMoteGeo,
        new THREE.PointsMaterial({ color: 0xf0abfc, size: 0.22, transparent: true, opacity: 0.95 }),
      ),
    );

    // Dual-color floating violet + warm gold fireflies around the cottages & trees
    const makeMotes = (color: number, count: number, minY = -2.5, maxY = 6.5, size = 0.16) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 18;
        pos[i * 3 + 1] = minY + Math.random() * (maxY - minY);
        pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.88 }));
    };
    scene.add(makeMotes(0xffe7c2, 32, 0.8, 6.2, 0.13));
    scene.add(makeMotes(0xd8b4fe, 42, -9.5, -1.5, 0.18));
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
        playCue("hop");
        return;
      }
      if (isChildOf(hit.object, fox)) {
        foxHopUntil = nowMs + 860;
        spark(0xe8893a, at, 10);
        playCue("hop");
        return;
      }
      if (isChildOf(hit.object, hen)) {
        henHopUntil = nowMs + 640;
        spark(0xfff4e4, at, 8);
        playCue("hop");
        return;
      }
      if (isChildOf(hit.object, bird)) {
        birdFlyUntil = nowMs + 1400;
        spark(0xd7e4f5, at, 8);
        playCue("hop");
        return;
      }
      spark(0xffe49e, at, 12);
      playCue("spark");
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
    let prevMs = performance.now();
    let elapsedSec = 0;
    let seenPhase = stateRef.current.round?.phase ?? "idle";
    let seenVotes = stateRef.current.round?.tallies.reduce((sum, row) => sum + row.votes, 0) ?? 0;
    let seenCelebration = stateRef.current.celebrations?.at(-1)?.id ?? null;
    let seenStepCount = stateRef.current.round?.execution?.steps.length ?? 0;
    const targetFlag = new THREE.Color();
    const mcpTargetColor = new THREE.Color();
    const skyTopTarget = new THREE.Color();
    const skyMidTarget = new THREE.Color();
    const skyHorTarget = new THREE.Color();
    const fogTarget = new THREE.Color();
    const hemiNightColor = new THREE.Color(0xa38ef0);

    const animate = () => {
      frame += 1;
      const nowMs = performance.now();
      const dt = Math.min(0.05, Math.max(0.004, (nowMs - prevMs) / 1000));
      prevMs = nowMs;
      elapsedSec += dt;
      const t = elapsedSec;

      if (!transparent) {
        const isDay =
          Boolean(container.closest('[data-ov-theme="light"]')) ||
          (!container.closest('[data-ov-theme="dark"]') && document.documentElement.dataset.theme === "light");
        skyTopTarget.setHex(isDay ? 0x93c5fd : 0x0b0521);
        skyMidTarget.setHex(isDay ? 0xc7d2fe : 0x1c1046);
        skyHorTarget.setHex(isDay ? 0xf3e8ff : 0x371f6e);
        fogTarget.setHex(isDay ? 0xdbeafe : 0x1f1147);
        skyMat.uniforms.topColor?.value.lerp(skyTopTarget, 0.06);
        skyMat.uniforms.midColor?.value.lerp(skyMidTarget, 0.06);
        skyMat.uniforms.horizonColor?.value.lerp(skyHorTarget, 0.06);
        if (scene.fog instanceof THREE.Fog) scene.fog.color.lerp(fogTarget, 0.06);
        sun.intensity += ((isDay ? 3.05 : 2.45) - sun.intensity) * 0.06;
        hemi.intensity += ((isDay ? 1.45 : 1.05) - hemi.intensity) * 0.06;
        hemi.color.lerp(isDay ? skyTopTarget : hemiNightColor, 0.06);
        starMat.opacity += ((isDay ? 0.08 : 0.92) - starMat.opacity) * 0.06;
      }

      const pal = resolveThemePalette(stateRef.current.round?.prompt, stateRef.current.round?.modifiers);
      targetFlag.setHex(pal.crystal);
      crystalMat.emissive.lerp(targetFlag, 0.05);

      const round = stateRef.current.round;
      const phase = round?.phase ?? "idle";
      const agentActive = phase === "executing" || phase === "planning" || phase === "awaiting_approval";
      const stepCount = round?.execution?.steps.length ?? 0;
      if (stepCount > seenStepCount) {
        seenStepCount = stepCount;
        const latestText = (round?.execution?.steps.at(-1)?.text ?? "").toLowerCase();
        if (/edit|write|create|patch/.test(latestText)) {
          spark(0xf5b942, { x: 0.15, y: 2.3, z: 0.8 }, 12);
          spark(0xc084fc, { x: 2.3, y: 2.1, z: 3.2 }, 8);
        } else if (/test|vitest|pass|check/.test(latestText)) {
          spark(0x34d399, { x: -0.2, y: 3.2, z: 1.2 }, 14);
          spark(0x34d399, { x: 2.3, y: 2.1, z: 3.2 }, 10);
        } else {
          spark(0x38bdf8, { x: 2.3, y: 2.1, z: 3.2 }, 10);
        }
      } else if (stepCount < seenStepCount) {
        seenStepCount = stepCount;
      }

      // Animate MCP Relay Beacon according to execution & agent connection state
      const spinSpeed = phase === "executing" ? 3.2 : agentActive ? 1.8 : 0.8;
      mcpCrystal.rotation.y = t * spinSpeed;
      mcpCrystal.position.y = 2.15 + Math.sin(t * 2.4) * 0.08;
      mcpTargetColor.setHex(phase === "executing" ? 0x38bdf8 : phase === "done" ? 0x34d399 : agentActive ? 0xc084fc : 0x7e22ce);
      mcpCrystalMat.emissive.lerp(mcpTargetColor, 0.08);
      mcpCrystalMat.emissiveIntensity = phase === "executing" ? 1.4 : agentActive ? 1.0 : 0.65;
      const ringPhase = (t * (phase === "executing" ? 1.2 : 0.55)) % 1;
      mcpRing.position.y = 1.7 + ringPhase * 0.72;
      const ringScale = 0.8 + ringPhase * 0.9;
      mcpRing.scale.set(ringScale, ringScale, 1);
      mcpRingMat.opacity = (phase === "executing" || agentActive ? 0.65 : 0.25) * (1 - ringPhase);

      // Animate left-side Ballot Totem bars from live ideas/votes
      const ideas = round?.ideas.filter((i) => !i.hidden) ?? [];
      const ballot = round ? computeBallot(round, false).slice(0, ballotBars.length) : [];
      const topVotes = Math.max(1, ...ballot.map((row) => row.votes));
      const counting =
        phase === "voting" || phase === "planning" || phase === "awaiting_approval" || phase === "executing" || phase === "done";
      ballotBars.forEach((bar, i) => {
        const row = ballot[i];
        const frac = row ? (counting ? row.votes / topVotes : 0.45) : 0.12;
        const targetH = 0.45 + frac * 3.4;
        bar.scale.y += (targetH - bar.scale.y) * 0.12;
        bar.position.y = 0.72 + bar.scale.y * 0.236;
        ballotBarMats[i]!.emissiveIntensity = row && row.votes > 0 ? 0.95 : 0.22;
      });
      const collecting = phase === "collecting" || ideas.length > 0;
      letter.visible = collecting;
      letterMat.emissiveIntensity = phase === "collecting" ? 1.15 + Math.sin(t * 4) * 0.2 : 0.35;
      const planning = phase === "planning" || phase === "awaiting_approval" || phase === "executing" || phase === "done";
      planSheet.visible = planning;
      planSheetMat.emissiveIntensity = phase === "planning" || phase === "awaiting_approval" ? 0.7 : 0.2;
      const gearSpin = t * (phase === "executing" ? 2.2 : 0.28);
      stallGear.rotation.z = gearSpin;
      stallGearMat.emissiveIntensity = phase === "executing" ? 0.9 : 0.25;
      for (const gear of workshopGears) gear.rotation.z = gearSpin;
      const building = phase === "planning" || phase === "awaiting_approval" || phase === "executing";
      scaffold.visible = building;
      scaffoldExtra.visible = phase === "executing";
      hallLight.intensity = building ? 0.55 : 2.4;
      towerCap.visible = phase === "done";
      towerCap.position.y = 4.7 + Math.sin(t * 2.2) * 0.12;
      towerCapMat.emissiveIntensity = phase === "done" ? 1.5 : 0.35;
      for (const puff of clouds) puff.position.x += Math.sin(t * 0.15 + puff.position.z) * 0.004;
      const voteSum = ballot.reduce((sum, row) => sum + row.votes, 0);
      if (voteSum > seenVotes) {
        spark(0xc084fc, { x: -1.7, y: 2.1, z: 11.1 }, 14);
        const voter = villagers[1];
        if (voter) voter.hopUntil = nowMs + 780;
      }
      seenVotes = voteSum;
      if (phase !== seenPhase) {
        if (phase === "done") {
          for (const [x, z, color] of [
            [-2.4, -6.2, 0xc084fc],
            [4.6, -6.2, 0xf5b942],
            [0.2, 1.2, 0x38bdf8],
            [-4.4, 5.4, 0xe879f9],
            [5.8, 5.2, 0xf9a8d4],
          ] as const) {
            spark(color, { x, y: 4.4, z }, 18);
          }
        }
        seenPhase = phase;
        spark(0xffb44c, { x: -1.7, y: 2.1, z: 11.1 }, 14);
        for (const v of villagers) v.hopUntil = nowMs + 520;
      }
      if (phase === "done" && frame % 28 === 0) {
        spark(frame % 56 === 0 ? 0xf5b942 : 0xc084fc, { x: Math.sin(t) * 3.2, y: 4.8, z: Math.cos(t) * 2.4 }, 8);
      }
      const celebration = stateRef.current.celebrations?.at(-1);
      if (celebration && celebration.id !== seenCelebration) {
        seenCelebration = celebration.id;
        foxHopUntil = nowMs + 1100;
        birdFlyUntil = nowMs + 1400;
        spark(0xf5b942, { x: fox.position.x, y: 1.1, z: fox.position.z }, 16);
      }

      const followRoute = (pos: THREE.Vector3, points: THREE.Vector3[], idx: number, speed: number) => {
        let i = idx;
        let goal = points[i % points.length]!;
        if (Math.hypot(goal.x - pos.x, goal.z - pos.z) < 0.35) {
          i = (i + 1) % points.length;
          goal = points[i]!;
        }
        const dx = goal.x - pos.x;
        const dz = goal.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.04) {
          const stepDist = Math.min(dist, speed);
          pos.x += (dx / dist) * stepDist;
          pos.z += (dz / dist) * stepDist;
        }
        return { i, dx, dz, moving: dist > 0.12 };
      };

      type Station = { x: number; z: number; faceX: number; faceZ: number; elev?: number };
      const stationsByPhase: Record<string, Station[]> = {
        collecting: [
          { x: -6.4, z: 9.8, faceX: -8.0, faceZ: 10.3 },   // 0 Scout at !idea Post Pavilion
          { x: -2.1, z: 10.8, faceX: -2.1, faceZ: 12.3 },  // 1 Teller at Ballot Obelisk
          { x: 2.8, z: 10.0, faceX: 4.45, faceZ: 10.2 },   // 2 Planner at Blueprint Gazebo
          { x: -5.2, z: 2.2, faceX: -0.5, faceZ: 1.8 },    // 3 Builder welcoming at West-Central Plaza
        ],
        voting: [
          { x: -3.4, z: 11.0, faceX: -2.1, faceZ: 12.3 },  // 0 Scout cheering left of Ballot Obelisk
          { x: -0.8, z: 11.0, faceX: -2.1, faceZ: 12.3 },  // 1 Teller tallying right of Ballot Obelisk
          { x: 2.8, z: 10.0, faceX: 4.45, faceZ: 10.2 },   // 2 Planner preparing Blueprint Gazebo
          { x: 7.2, z: 1.6, faceX: 3.5, faceZ: 0.4 },      // 3 Builder prepping at East Workshop Court
        ],
        planning: [
          { x: -2.1, z: 10.8, faceX: 4.45, faceZ: 10.2 },  // 0 Scout relaying ideas from Ballot Obelisk
          { x: 2.8, z: 9.8, faceX: 4.45, faceZ: 10.2 },    // 1 Teller briefing left of Blueprint Gazebo
          { x: 5.8, z: 9.8, faceX: 4.45, faceZ: 10.2 },    // 2 Planner leading briefing right of Blueprint Gazebo
          { x: -5.0, z: 2.2, faceX: 0.15, faceZ: 1.2 },    // 3 Builder inspecting Central Workshop bay
        ],
        executing: [
          { x: -2.8, z: 9.6, faceX: -2.1, faceZ: 12.3 },              // 0 Scout reporting live status at South Promenade
          { x: 2.95, z: 0.85, faceX: 1.8, faceZ: -0.4, elev: 1.58 },  // 1 Teller wrenching on Workshop Scaffolding
          { x: 7.2, z: 1.6, faceX: 2.5, faceZ: 0.4 },                 // 2 Planner coordinating from East Stone Plaza
          { x: -5.0, z: 2.2, faceX: -0.5, faceZ: 0.4 },               // 3 Builder forging at West Workshop Court
        ],
        done: [
          { x: -3.6, z: 9.4, faceX: 4, faceZ: 14 },
          { x: -1.4, z: 10.2, faceX: 4, faceZ: 14 },
          { x: 1.0, z: 10.2, faceX: 4, faceZ: 14 },
          { x: 3.0, z: 9.4, faceX: 4, faceZ: 14 },
        ],
      };
      const activeStations =
        phase === "awaiting_approval" ? stationsByPhase.planning : stationsByPhase[phase];

      villagers.forEach((v, idx) => {
        const hopping = nowMs < v.hopUntil;
        const hop = hopping ? Math.sin(((v.hopUntil - nowMs) / 720) * Math.PI) * 0.42 : 0;
        const st = activeStations ? activeStations[idx % activeStations.length] : undefined;
        let moving = false;
        let holding = false;
        let tvx = 0;
        let tvz = 0;

        if (st) {
          const dx = st.x - v.group.position.x;
          const dz = st.z - v.group.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.12) {
            const maxSpd = phase === "executing" ? 3.4 : 2.7;
            const desiredSpd = maxSpd * Math.min(1, dist / 1.1);
            tvx = (dx / dist) * desiredSpd;
            tvz = (dz / dist) * desiredSpd;
            moving = desiredSpd > 0.18;
          } else {
            holding = true;
          }
        } else {
          // Smooth corner-rounding patrol along villageLoop waypoints
          let goal = v.waypoints[v.wpIdx % v.waypoints.length]!;
          if (Math.hypot(goal.x - v.group.position.x, goal.z - v.group.position.z) < 0.58) {
            v.wpIdx = (v.wpIdx + 1) % v.waypoints.length;
            goal = v.waypoints[v.wpIdx]!;
          }
          const dx = goal.x - v.group.position.x;
          const dz = goal.z - v.group.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.04) {
            tvx = (dx / dist) * 1.55;
            tvz = (dz / dist) * 1.55;
            moving = true;
          }
        }

        // Smooth velocity damping (zero abrupt starts/stops or direction snaps)
        const accel = 1 - Math.exp(-dt * 7.5);
        v.vx += (tvx - v.vx) * accel;
        v.vz += (tvz - v.vz) * accel;

        // Pairwise personal-space repulsion so two engineers never overlap or clip through each other
        for (let j = 0; j < villagers.length; j++) {
          if (j === idx) continue;
          const other = villagers[j]!;
          const rx = v.group.position.x - other.group.position.x;
          const rz = v.group.position.z - other.group.position.z;
          const d = Math.hypot(rx, rz);
          if (d > 0.001 && d < 1.45 && !holding) {
            const push = ((1.45 - d) / 1.45) * 1.15;
            v.vx += (rx / d) * push * accel;
            v.vz += (rz / d) * push * accel;
          }
        }

        // Building obstacle avoidance (smooth tangential steering + hard push-out so engineers never clip through houses)
        for (const obs of buildingColliders) {
          const toOx = obs.x - v.group.position.x;
          const toOz = obs.z - v.group.position.z;
          const distO = Math.hypot(toOx, toOz);
          const avoidR = obs.r + 1.15;
          if (distO < avoidR && distO > 0.001) {
            const nx = toOx / distO;
            const nz = toOz / distO;
            const dot = v.vx * nx + v.vz * nz;
            if (dot > 0) {
              // Steer tangentially around the building along the side aligned with current velocity
              const tx1 = -nz;
              const tz1 = nx;
              const side = v.vx * tx1 + v.vz * tz1 >= 0 ? 1 : -1;
              const strength = ((avoidR - distO) / 1.15) * 1.45;
              v.vx -= nx * dot * 0.85;
              v.vz -= nz * dot * 0.85;
              v.vx += tx1 * side * strength;
              v.vz += tz1 * side * strength;
            }
          }
        }

        v.group.position.x += v.vx * dt;
        v.group.position.z += v.vz * dt;

        // Hard boundary push-out guarantee
        for (const obs of buildingColliders) {
          const fx = v.group.position.x - obs.x;
          const fz = v.group.position.z - obs.z;
          const fd = Math.hypot(fx, fz);
          if (fd < obs.r && fd > 0.001) {
            v.group.position.x = obs.x + (fx / fd) * obs.r;
            v.group.position.z = obs.z + (fz / fd) * obs.r;
          }
        }

        const speed = Math.hypot(v.vx, v.vz);

        // Shortest-arc yaw alignment
        const desiredYaw =
          holding && st
            ? Math.atan2(st.faceX - v.group.position.x, st.faceZ - v.group.position.z)
            : speed > 0.08
              ? Math.atan2(v.vx, v.vz)
              : v.group.rotation.y;
        const yawDiff = Math.atan2(
          Math.sin(desiredYaw - v.group.rotation.y),
          Math.cos(desiredYaw - v.group.rotation.y),
        );
        v.group.rotation.y += yawDiff * (1 - Math.exp(-dt * 9.5));

        // Smooth walk-to-idle blend & continuous distance-locked stride phase (no snap/skate)
        const targetBlend = moving ? Math.min(1, speed / 1.35) : 0;
        v.walkBlend += (targetBlend - v.walkBlend) * (1 - Math.exp(-dt * 9.0));
        v.stridePhase += dt * (1.8 + speed * 3.4);
        const step = Math.sin(v.stridePhase);
        const stepCos = Math.cos(v.stridePhase);

        // Smooth elevation adaptation + natural double-frequency stride bounce
        const targetElev = st && holding && st.elev !== undefined ? st.elev : v.base.y;
        const curBaseY = v.group.position.y - hop;
        const nextBaseY = curBaseY + (targetElev - curBaseY) * (1 - Math.exp(-dt * 8.5));
        const strideBob = Math.abs(step) * 0.068 * v.walkBlend;

        v.group.position.y = nextBaseY + hop + strideBob;
        // Subtle forward lean + weight shift & turn banking
        v.group.rotation.x = 0.055 * v.walkBlend;
        v.group.rotation.z = -yawDiff * 0.08 * v.walkBlend + step * 0.036 * v.walkBlend;

        const legAmp = 0.08 * (1 - v.walkBlend) + 0.62 * v.walkBlend;
        v.leftLeg.rotation.x = hopping ? -0.5 : step * legAmp;
        v.rightLeg.rotation.x = hopping ? 0.5 : -step * legAmp;
        v.head.rotation.x = Math.sin(v.stridePhase * 2) * 0.035 * v.walkBlend;
        v.head.rotation.y = yawDiff * 0.25 * v.walkBlend;

        for (const gm of v.glowMats) {
          gm.emissiveIntensity = holding ? 1.35 : 0.75;
        }

        const execFailed =
          phase === "rejected" ||
          (phase === "done" && (round?.execution?.status === "failed" || round?.execution?.status === "cancelled"));
        const latestStep = round?.execution?.steps.at(-1);
        const isErrorStep = latestStep?.kind === "error";

        if (execFailed) {
          v.leftArm.rotation.x = -0.25;
          v.rightArm.rotation.x = -0.25;
          v.leftArm.rotation.z = 0.18;
          v.rightArm.rotation.z = -0.18;
          v.head.rotation.x = 0.26;
          v.head.rotation.y = Math.sin(t * 2.8 + idx) * 0.2;
        } else if (phase === "done") {
          v.group.position.y = nextBaseY + Math.abs(Math.sin(t * 5 + v.phase)) * 0.36;
          v.leftArm.rotation.x = -2.35;
          v.rightArm.rotation.x = -2.35;
          v.leftArm.rotation.z = 0;
          v.rightArm.rotation.z = 0;
          v.head.rotation.x = -0.1;
          v.head.rotation.y = Math.sin(t * 3 + idx) * 0.22;
        } else if (phase === "executing" && holding) {
          if (isErrorStep) {
            v.leftArm.rotation.x = -0.2;
            v.rightArm.rotation.x = -0.2;
            v.leftArm.rotation.z = 0.12;
            v.rightArm.rotation.z = -0.12;
            v.head.rotation.x = 0.16;
            v.head.rotation.y = Math.sin(t * 6 + idx) * 0.26;
          } else if (idx === 2) {
            // Planner holds holographic tablet with both hands and monitors progress
            v.leftArm.rotation.x = -0.78;
            v.rightArm.rotation.x = -0.78;
            v.leftArm.rotation.z = -0.18;
            v.rightArm.rotation.z = 0.18;
            v.head.rotation.x = -0.05 + Math.sin(t * 2.4) * 0.16;
            v.head.rotation.y = Math.sin(t * 1.4) * 0.18;
          } else if (idx === 0) {
            // Scout relays live status outward to viewers
            v.leftArm.rotation.x = -0.7 + Math.sin(t * 3.5) * 0.25;
            v.rightArm.rotation.x = -0.35;
            v.leftArm.rotation.z = 0.08;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = 0;
            v.head.rotation.y = Math.sin(t * 1.8) * 0.28;
          } else {
            // Builder & Teller hammer and wrench on the clockwork workshop
            v.leftArm.rotation.x = step * 0.25;
            v.rightArm.rotation.x = -0.95 - Math.abs(Math.sin(t * 9 + v.phase)) * 1.25;
            v.leftArm.rotation.z = 0;
            v.rightArm.rotation.z = 0;
            v.head.rotation.x = 0.18;
            if (idx === 3 && frame % 18 === 0) spark(0xf5b942, { x: 0.15, y: 2.2, z: 0.4 }, 5);
            if (idx === 1 && frame % 24 === 0) spark(0x38bdf8, { x: 2.35, y: 2.3, z: 0.4 }, 4);
          }
        } else if (phase === "planning" && holding) {
          if (idx === 2) {
            v.leftArm.rotation.x = -0.85 + Math.sin(t * 3.2) * 0.12;
            v.rightArm.rotation.x = -0.75;
            v.leftArm.rotation.z = -0.14;
            v.rightArm.rotation.z = 0.14;
            v.head.rotation.x = 0.12 + Math.sin(t * 4.5) * 0.14;
            v.head.rotation.y = Math.cos(t * 2.2) * 0.16;
          } else {
            v.leftArm.rotation.x = -0.25;
            v.rightArm.rotation.x = -0.25;
            v.leftArm.rotation.z = 0.06;
            v.rightArm.rotation.z = -0.06;
            v.head.rotation.x = 0.12;
            v.head.rotation.y = Math.cos(t * 1.8 + idx) * 0.2;
          }
        } else if (phase === "awaiting_approval" && holding) {
          if (idx === 2) {
            // Planner presents blueprint tablet for streamer approval
            v.leftArm.rotation.x = -1.25 + Math.sin(t * 2.5) * 0.08;
            v.rightArm.rotation.x = -1.15;
            v.leftArm.rotation.z = -0.12;
            v.rightArm.rotation.z = 0.12;
            v.head.rotation.x = -0.08;
          } else if (idx === 3) {
            // Builder holds hammer at the ready
            v.leftArm.rotation.x = -0.2;
            v.rightArm.rotation.x = -1.05 + Math.sin(t * 3) * 0.1;
            v.leftArm.rotation.z = 0.05;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = 0;
          } else {
            v.leftArm.rotation.x = -0.18;
            v.rightArm.rotation.x = -0.18;
            v.leftArm.rotation.z = 0.06;
            v.rightArm.rotation.z = -0.06;
            v.head.rotation.x = 0;
            v.head.rotation.y = Math.sin(t * 1.6 + idx) * 0.18;
          }
        } else if (phase === "collecting" && holding) {
          if (idx === 0) {
            // Scout waves to viewers at the !idea pavilion
            v.leftArm.rotation.x = -1.55 + Math.sin(t * 5) * 0.42;
            v.rightArm.rotation.x = -0.25;
            v.leftArm.rotation.z = 0.25;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = 0;
            v.head.rotation.y = Math.sin(t * 2.4) * 0.24;
          } else if (idx === 1) {
            // Teller logs incoming proposals
            v.leftArm.rotation.x = -0.35;
            v.rightArm.rotation.x = -0.75 + Math.sin(t * 4) * 0.18;
            v.leftArm.rotation.z = 0.05;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = 0.18;
          } else {
            v.leftArm.rotation.x = Math.sin(t * 1.8 + idx) * 0.08;
            v.rightArm.rotation.x = -Math.sin(t * 1.8 + idx) * 0.08;
            v.leftArm.rotation.z = 0.05;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = 0;
            v.head.rotation.y = Math.sin(t * 1.2 + idx) * 0.22;
          }
        } else if (phase === "voting" && holding) {
          if (idx === 1) {
            // Teller tallies votes on the ballot obelisk
            v.leftArm.rotation.x = -0.35;
            v.rightArm.rotation.x = -0.9 + Math.sin(t * 5.2) * 0.35;
            v.leftArm.rotation.z = 0.05;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = Math.sin(t * 4) * 0.15;
          } else if (idx === 0) {
            // Scout cheers for votes
            v.leftArm.rotation.x = -1.35 + Math.sin(t * 4.2) * 0.4;
            v.rightArm.rotation.x = -0.25;
            v.leftArm.rotation.z = 0.18;
            v.rightArm.rotation.z = -0.05;
            v.head.rotation.x = 0;
          } else {
            v.leftArm.rotation.x = -0.6 + Math.sin(t * 3 + idx) * 0.22;
            v.rightArm.rotation.x = -0.6 - Math.sin(t * 3 + idx) * 0.22;
            v.leftArm.rotation.z = 0;
            v.rightArm.rotation.z = 0;
            v.head.rotation.x = 0;
          }
        } else {
          const armAmp = 0.08 * (1 - v.walkBlend) + 0.48 * v.walkBlend;
          v.leftArm.rotation.x = hopping ? -0.8 : -step * armAmp - 0.06 * v.walkBlend;
          v.rightArm.rotation.x = hopping ? -0.8 : step * armAmp - 0.06 * v.walkBlend;
          v.leftArm.rotation.z = 0.05 + Math.abs(stepCos) * 0.04 * v.walkBlend;
          v.rightArm.rotation.z = -0.05 - Math.abs(stepCos) * 0.04 * v.walkBlend;
          v.head.rotation.x = 0;
        }
      });

      const foxStep = followRoute(fox.position, foxRoute, foxWp, 0.036);
      foxWp = foxStep.i;
      if (foxStep.moving) {
        const foxTargetRot = Math.atan2(foxStep.dx, foxStep.dz);
        fox.rotation.y += Math.sin(foxTargetRot - fox.rotation.y) * 0.18;
      }
      const foxPlayHop = Math.max(0, Math.sin(t * 1.9) - 0.86) * 1.6;
      fox.position.y =
        foxBase.y +
        (nowMs < foxHopUntil ? Math.sin(((foxHopUntil - nowMs) / 860) * Math.PI) * 0.38 : foxPlayHop);
      foxTail.rotation.y = Math.sin(t * 5.4) * 0.48;
      const foxStride = Math.sin(t * 9.5) * 0.42;
      if (foxLegs[0]) foxLegs[0].rotation.x = foxStride;
      if (foxLegs[1]) foxLegs[1].rotation.x = -foxStride;
      if (foxLegs[2]) foxLegs[2].rotation.x = -foxStride;
      if (foxLegs[3]) foxLegs[3].rotation.x = foxStride;

      const henPecking = Math.sin(t * 1.4) > 0.55;
      if (!henPecking) {
        const henStep = followRoute(hen.position, henRoute, henWp, 0.018);
        henWp = henStep.i;
        if (henStep.moving) {
          const henTargetRot = Math.atan2(henStep.dx, henStep.dz);
          hen.rotation.y += Math.sin(henTargetRot - hen.rotation.y) * 0.16;
        }
      }
      hen.position.y =
        henBase.y +
        (nowMs < henHopUntil
          ? Math.sin(((henHopUntil - nowMs) / 640) * Math.PI) * 0.28
          : !henPecking
            ? Math.abs(Math.sin(t * 8.5)) * 0.05
            : 0);
      henHead.rotation.x = henPecking ? Math.abs(Math.sin(t * 11)) * 0.55 : 0.08;

      const birdSoaring = nowMs < birdFlyUntil || Math.sin(t * 0.42) > -0.2;
      if (birdSoaring) {
        const theta = t * 0.85;
        const bx = -2.2 + Math.sin(theta) * 5.8;
        const bz = 3.8 + Math.sin(theta * 2) * 3.2;
        const by = 4.65 + Math.cos(theta * 2) * 0.45;
        const vx = Math.cos(theta) * 5.8;
        const vz = Math.cos(theta * 2) * 6.4;
        bird.position.x += (bx - bird.position.x) * 0.08;
        bird.position.z += (bz - bird.position.z) * 0.08;
        bird.position.y += (by - bird.position.y) * 0.08;
        const birdYaw = Math.atan2(vx, vz);
        bird.rotation.y += Math.sin(birdYaw - bird.rotation.y) * 0.18;
        wingL.rotation.z = Math.sin(t * 16) * 0.68;
        wingR.rotation.z = -Math.sin(t * 16) * 0.68;
      } else {
        bird.position.x += (birdBase.x - bird.position.x) * 0.08;
        bird.position.z += (birdBase.z - bird.position.z) * 0.08;
        bird.position.y += (birdBase.y - bird.position.y) * 0.08;
        wingL.rotation.z = Math.sin(t * 4) * 0.15;
        wingR.rotation.z = -Math.sin(t * 4) * 0.15;
      }

      // Animate vertical falling starlight streams under the island's crystal veins
      const streamAttr = streamMoteGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < streamMoteCount; i++) {
        const a = streamAnchors[i % streamAnchors.length]!;
        let ny = streamAttr.getY(i) - 0.035;
        if (ny < a[1] - 5.8) ny = a[1];
        streamAttr.setY(i, ny);
      }
      streamAttr.needsUpdate = true;

      for (const m of milestoneTowers) m.group.visible = phase === "done";
      blueprintCube.visible = phase === "planning" || phase === "awaiting_approval" || phase === "executing";
      if (blueprintCube.visible) {
        blueprintCube.rotation.y += phase === "executing" ? 0.045 : 0.018;
        blueprintCube.position.y = 6.2 + Math.sin(t * 2.6) * 0.22;
      }
      islandGroup.position.y = Math.sin(t * 0.65) * 0.08;
      porchLight.intensity = 2.6 + Math.sin(t * 2.2) * 0.25;
      underLightL.intensity = 3.5 + Math.sin(t * 1.8) * 0.45;
      underLightR.intensity = 3.5 + Math.cos(t * 1.8) * 0.45;

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

      if (cameraGoalRef.current) {
        const goal = cameraGoalRef.current;
        const goalPos = new THREE.Vector3(...goal.pos);
        const goalTarget = new THREE.Vector3(...goal.target);
        camera.position.lerp(goalPos, 0.045);
        controls.target.lerp(goalTarget, 0.045);
        if (camera.position.distanceTo(goalPos) < 0.08 && controls.target.distanceTo(goalTarget) < 0.05) {
          cameraGoalRef.current = null;
        }
      }

      if (frame % (phase === "executing" ? 16 : 34) === 0) {
        spawnSmoke(1.65, 5.65, -2.0);
        if (frame % (phase === "executing" ? 32 : 68) === 0) {
          spawnSmoke(6.4, 3.85, -9.2);
        }
      }
      for (let i = smokePuffs.length - 1; i >= 0; i--) {
        const sp = smokePuffs[i]!;
        sp.life += dt;
        const p = sp.life / sp.maxLife;
        if (p >= 1) {
          islandGroup.remove(sp.mesh);
          sp.mat.dispose();
          smokePuffs.splice(i, 1);
        } else {
          sp.mesh.position.x += sp.vx * dt;
          sp.mesh.position.y += sp.vy * dt;
          sp.mesh.position.z += sp.vz * dt;
          sp.mesh.rotation.y += dt * 0.6;
          sp.mesh.scale.setScalar(0.32 + p * 0.58);
          sp.mat.opacity = 0.46 * (1 - p);
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
      controls.removeEventListener("start", onControlStart);
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

      {!compact &&
        !transparent &&
        ideas.map((idea, idx) => (
          <div
            key={idea.id}
            className={`workshop-bubble workshop-bubble--flank workshop-bubble--flank-${idx} ${idea.boosts ? "is-boosted" : ""}`}
          >
            <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
            <span className="workshop-bubble__text">{truncate(idea.text, 22)}</span>
            {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
          </div>
        ))}

      {!compact &&
        !transparent &&
        (state.coBuilders ?? []).slice(0, 3).map((b, idx) => (
          <div key={b.login} className="workshop-builder-pin" style={{ bottom: 12 + idx * 22 }}>
            <span className="workshop-builder-pin__dot" aria-hidden="true" />
            <span>@{b.displayName || b.login}</span>
            <span className="workshop-builder-pin__count">{b.shipped}</span>
          </div>
        ))}
    </div>
  );
}

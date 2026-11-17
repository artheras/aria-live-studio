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
import { villageLoop } from "./stage/routes";

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
    camera.position.set(compact ? 18.4 : 17.2, compact ? 11.4 : 10.6, compact ? 19.2 : 18.0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controls.minDistance = 5.5;
    controls.maxDistance = 34;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.target.set(0.15, compact ? 1.7 : 1.55, 0.15);

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
    porchLight.position.set(-4.4, 2.3, 6.6);
    scene.add(porchLight);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const voxelGeo = new RoundedBoxGeometry(0.472, 0.472, 0.472, 2, 0.042);
    const stoneLightMat = new THREE.MeshStandardMaterial({ color: 0xd9d0c4, roughness: 0.82 });
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
        });
        buildings.add(model);
      });
    };
    placeGlb("/models/cottage-garden.glb", -4.4, 0.46, 5.6, 0, 1.5);
    placeGlb("/models/cottage-lantern.glb", 5.8, 0, 5.8, 0, 1.5);
    placeGlb("/models/cottage-timber.glb", -7.6, 0.92, 0.2, Math.PI / 2, 1.5);
    placeGlb("/models/cottage-stone.glb", 7.8, 1.38, 0.2, -Math.PI / 2, 1.5);
    placeGlb("/models/cottage-violet.glb", -2.4, 0.92, -7.6, 0, 1.5);
    placeGlb("/models/cottage-hearth.glb", 4.6, 0.46, -7.6, 0, 1.5);
    placeGlb("/models/workshop.glb", 0.15, 1.38, -0.4, 0, 1.4);

    // Dynamic MCP Relay Beacon crystal + rising pulse ring
    const mcpCrystalMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0x7e22ce,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    const mcpCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), mcpCrystalMat);
    mcpCrystal.position.set(2.3, 2.15, 3.2);
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
    troughWater.scale.set(1.05, 0.16, 0.38);
    troughWater.position.set(7.65, 0.5, 11.3);
    islandGroup.add(troughWater);
    const mcpRingMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const mcpRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 16), mcpRingMat);
    mcpRing.rotation.x = -Math.PI / 2;
    mcpRing.position.set(2.3, 1.7, 3.2);
    islandGroup.add(mcpCrystal, mcpRing);

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
      m.scale.set(0.72, 0.45, 0.42);
      m.position.set(-0.43 + i * 0.52, 0.85, 11.85);
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
      leftLeg: THREE.Object3D;
      rightLeg: THREE.Object3D;
      leftArm: THREE.Object3D;
      rightArm: THREE.Object3D;
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
        waypoints,
        wpIdx: 0,
        phase,
        hopUntil: 0,
        leftLeg,
        rightLeg,
        leftArm,
        rightArm,
      });
    };
    const loopPts = villageLoop.map(([x, z]) => new THREE.Vector3(x, 0.08, z));
    const ringFrom = (start: number, dir: 1 | -1) => {
      const n = loopPts.length;
      return Array.from({ length: n }, (_, k) => loopPts[(start + dir * k + n * 4) % n]!);
    };
    const outfits: Array<[number, number, number]> = [
      [0xc47a4a, 0x6b3e22, 0.2],
      [0x4e9a52, 0x8d8276, 1.4],
      [0xd9d0c4, 0x5a4032, 2.6],
      [0xc4894a, 0xf5b942, 3.8],
    ];
    const patrols: Array<[number, 1 | -1]> = [
      [0, 1],
      [8, 1],
      [4, -1],
      [14, -1],
    ];
    outfits.forEach(([shirt, hat, phase], idx) => {
      const [start, dir] = patrols[idx]!;
      const pts = ringFrom(start, dir);
      const p = pts[0]!;
      addVillager(p.x, 0.08, p.z, shirt, hat, dir > 0 ? 0.4 : -0.4, phase, pts);
    });

    // Upgrade villagers with the 1:1 Aria Voxel Engineer GLB model (with articulated joints & tools)
    const toolRoles: Array<"hammer" | "wrench" | "tablet" | "hammer"> = ["hammer", "wrench", "tablet", "hammer"];
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
    const foxRoute = ringFrom(11, 1);
    const foxBase = foxRoute[0]!.clone();
    fox.position.copy(foxBase);
    let foxWp = 1;
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
    const henRoute = ringFrom(2, -1);
    const henBase = henRoute[0]!.clone();
    hen.scale.setScalar(1.25);
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
    const birdBase = new THREE.Vector3(-4.2, 4.7, 4.4);
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
    addVoxelCloud(-9.8, 5.8, 0.8, 1.2);
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
    let seenStepCount = stateRef.current.round?.execution?.steps.length ?? 0;
    const targetFlag = new THREE.Color();
    const mcpTargetColor = new THREE.Color();

    const animate = () => {
      frame += 1;
      const t = frame * 0.016;
      const nowMs = performance.now();

      const pal = resolveThemePalette(stateRef.current.round?.prompt, stateRef.current.round?.modifiers);
      targetFlag.setHex(pal.crystal);
      crystalMat.emissive.lerp(targetFlag, 0.05);

      const round = stateRef.current.round;
      const phase = round?.phase ?? "idle";
      const agentActive = phase === "executing" || phase === "planning" || phase === "awaiting_approval";
      const stepCount = round?.execution?.steps.length ?? 0;
      if (stepCount > seenStepCount) {
        seenStepCount = stepCount;
        spark(0x38bdf8, { x: 2.3, y: 2.1, z: 3.2 }, 10);
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
      const totalVotes = Math.max(1, round?.voters ?? 0);
      ballotBars.forEach((bar, i) => {
        const idea = ideas[i];
        const frac = idea
          ? phase === "voting" || phase === "planning" || phase === "awaiting_approval" || phase === "executing" || phase === "done"
            ? Math.min(1, (idea.seconds + 1) / (totalVotes + 1))
            : 0.45
          : 0.14;
        const targetH = 0.4 + frac * 2.6;
        bar.scale.y += (targetH - bar.scale.y) * 0.12;
        bar.position.y = 0.62 + bar.scale.y * 0.236;
        ballotBarMats[i]!.emissiveIntensity = idea ? 0.95 : 0.22;
      });
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

      const followRoute = (pos: THREE.Vector3, points: THREE.Vector3[], idx: number, speed: number) => {
        let i = idx;
        let goal = points[i % points.length]!;
        if (Math.hypot(goal.x - pos.x, goal.z - pos.z) < 0.18) {
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

      villagers.forEach((v, idx) => {
        const hopping = nowMs < v.hopUntil;
        const hop = hopping ? Math.sin(((v.hopUntil - nowMs) / 720) * Math.PI) * 0.42 : 0;
        const speed = phase === "done" || phase === "executing" ? 0.04 : 0.026;
        const walk = followRoute(v.group.position, v.waypoints, v.wpIdx, speed);
        v.wpIdx = walk.i;
        const moving = walk.moving;
        const dx = walk.dx;
        const dz = walk.dz;
        if (moving) {
          const targetRot = Math.atan2(dx, dz);
          v.group.rotation.y += Math.sin(targetRot - v.group.rotation.y) * 0.14;
        }

        const walkSpeed = moving ? 6.5 : 2.2;
        const step = Math.sin(t * walkSpeed + v.phase);
        v.group.position.y = v.base.y + hop;
        v.leftLeg.rotation.x = hopping ? -0.5 : moving ? step * 0.55 : step * 0.12;
        v.rightLeg.rotation.x = hopping ? 0.5 : moving ? -step * 0.55 : -step * 0.12;

        if (phase === "done") {
          v.group.position.y = v.base.y + Math.abs(Math.sin(t * 5 + v.phase)) * 0.36;
          v.leftArm.rotation.x = -2.35;
          v.rightArm.rotation.x = -2.35;
        } else if (phase === "executing" && !moving) {
          v.leftArm.rotation.x = step * 0.25;
          v.rightArm.rotation.x = -0.85 - Math.abs(Math.sin(t * 7 + v.phase)) * 0.95;
          if (frame % 26 === idx * 6) {
            spark(0xf5b942, { x: v.group.position.x, y: 1.0, z: v.group.position.z }, 5);
          }
        } else if (phase === "collecting" && !moving) {
          v.leftArm.rotation.x = -1.35 + Math.sin(t * 4 + v.phase) * 0.35;
          v.rightArm.rotation.x = -0.3;
        } else {
          v.leftArm.rotation.x = hopping ? -0.8 : moving ? step * 0.45 : step * 0.12;
          v.rightArm.rotation.x = hopping ? -0.8 : moving ? -step * 0.45 : -step * 0.12;
        }
      });

      const foxStep = followRoute(fox.position, foxRoute, foxWp, 0.046);
      foxWp = foxStep.i;
      if (foxStep.moving) fox.rotation.y = Math.atan2(foxStep.dx, foxStep.dz);
      fox.position.y = foxBase.y + (nowMs < foxHopUntil ? Math.sin(((foxHopUntil - nowMs) / 860) * Math.PI) * 0.38 : 0);
      foxTail.rotation.y = Math.sin(t * 5) * 0.45;

      const henStep = followRoute(hen.position, henRoute, henWp, 0.02);
      henWp = henStep.i;
      if (henStep.moving) hen.rotation.y = Math.atan2(henStep.dx, henStep.dz);
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

      for (const m of milestoneTowers) m.group.visible = phase === "done";
      blueprintCube.visible = phase === "planning" || phase === "awaiting_approval" || phase === "executing";
      if (blueprintCube.visible) {
        blueprintCube.rotation.y += phase === "executing" ? 0.045 : 0.018;
        blueprintCube.position.y = 6.2 + Math.sin(t * 2.6) * 0.22;
      }
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

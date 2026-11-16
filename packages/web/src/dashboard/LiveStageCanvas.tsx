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

    const camera = new THREE.PerspectiveCamera(37, width / height, 0.1, 160);
    camera.position.set(14.8, 10.6, 15.8);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.52, 0.45, 0.78));
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.minDistance = 9;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0.2, 2.3, 0);

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
          float h = normalize(vWorldPosition).y;
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.18, 0.2, h));
          col = mix(col, topColor, smoothstep(0.18, 0.72, h));
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

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const boxGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
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

    // 1. Craggy 11x11 floating rocky island + mossy grass terrace
    const grassSpecs: VoxelSpec[] = [];
    const mossSpecs: VoxelSpec[] = [];
    const dirtSpecs: VoxelSpec[] = [];

    for (let x = -5; x <= 5; x++) {
      for (let z = -5; z <= 5; z++) {
        const dist = Math.abs(x) + Math.abs(z);
        if (dist > 7) continue;
        const onTerrace = x >= -2 && x <= 3 && z >= -3 && z <= 1;
        if (onTerrace) {
          pushStone({ x, y: 0.5, z });
        } else if ((x + z) % 3 === 0) {
          mossSpecs.push({ x, y: 0.06, z });
        } else {
          grassSpecs.push({ x, y: 0, z });
        }
        if (dist <= 6) dirtSpecs.push({ x, y: -1, z });
        if (dist <= 4) stoneDarkSpecs.push({ x, y: -2, z });
        if (dist <= 3) stoneDarkSpecs.push({ x, y: -3, z });
        if (dist <= 1) stoneDarkSpecs.push({ x, y: -4, z });
      }
    }
    stoneDarkSpecs.push({ x: 0, y: -5, z: 0 }, { x: -1, y: -4.6, z: 1 });

    // Stepped front stone staircase + left/right parapet walls
    for (let s = 0; s < 3; s++) {
      const sy = 0.2 + s * 0.35;
      const sz = 4 - s;
      pushStone({ x: -1, y: sy, z: sz, sx: 1.5, sy: 0.4 + s * 0.15, sz: 0.92 });
      pushStone({ x: -2.0, y: sy + 0.3, z: sz, sx: 0.35, sy: 0.7, sz: 0.92 });
      pushStone({ x: 0.0, y: sy + 0.3, z: sz, sx: 0.35, sy: 0.7, sz: 0.92 });
    }

    // 2. Main Gabled Stone & Timber Manor (with framed glowing purple windows + warm arched doorway)
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
            windowSpecs.push({ x, y, z, sx: 0.75, sy: 0.85, sz: 0.75 });
            // Window sill & frame
            timberSpecs.push({ x, y: y - 0.5, z: z === 1 ? 1.45 : z, sx: 0.92, sy: 0.18, sz: 0.3 });
          } else if (isCorner) {
            timberSpecs.push({ x, y, z });
          } else {
            pushStone({ x, y, z });
          }
        }
      }
    }
    // Warm porch canopy + pillars
    timberSpecs.push(
      { x: -1.65, y: 1.5, z: 1.8, sx: 0.22, sy: 1.6, sz: 0.22 },
      { x: -0.35, y: 1.5, z: 1.8, sx: 0.22, sy: 1.6, sz: 0.22 },
      { x: -1.0, y: 2.35, z: 1.65, sx: 1.65, sy: 0.25, sz: 0.85 },
    );

    // Manor stepped pitched roof with overhanging eaves
    for (let z = -2.5; z <= 1.7; z += 1) {
      for (let x = -2.6; x <= 1.6; x += 1) {
        roofSpecs.push({ x, y: 4.3, z, sx: 0.96, sy: 0.65, sz: 0.96 });
      }
      for (let x = -1.6; x <= 0.6; x += 1) {
        roofSpecs.push({ x, y: 4.95, z, sx: 0.96, sy: 0.65, sz: 0.96 });
      }
      roofSpecs.push({ x: -0.5, y: 5.6, z, sx: 0.96, sy: 0.65, sz: 0.96 });
    }
    // Tall arched purple crystal gable window
    windowSpecs.push({ x: -0.5, y: 4.95, z: 1.65, sx: 0.92, sy: 1.05, sz: 0.42 });
    timberSpecs.push({ x: -0.5, y: 4.4, z: 1.72, sx: 1.15, sy: 0.16, sz: 0.3 });

    // 3. Tall Square Castle Watchtower (back-right) + Pyramidal Roof Cap
    for (let y = 1.5; y <= 6.5; y += 1) {
      for (let x = 1.5; x <= 3.5; x += 1) {
        for (let z = -3.5; z <= -1.5; z += 1) {
          const isTowerWin = y === 5.5 && ((z === -1.5 && x === 2.5) || (x === 1.5 && z === -2.5));
          if (isTowerWin) {
            windowSpecs.push({ x, y, z, sx: 0.78, sy: 0.95, sz: 0.78 });
          } else {
            pushStone({ x, y, z });
          }
        }
      }
    }
    // Watchtower corbelled battlements + stepped slate pyramid cap
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
    roofSpecs.push({ x: 2.5, y: 8.35, z: -2.5, sx: 0.9, sy: 0.65, sz: 0.9 });

    // 4. Dual Wooden Scaffolding (right tower + far-left manor) with ladder rungs
    const scaffSpecs: VoxelSpec[] = [
      // Right tower scaffolding
      { x: 4.2, y: 2.1, z: -3.2, sx: 0.2, sy: 4.0, sz: 0.2 },
      { x: 4.2, y: 2.1, z: -1.2, sx: 0.2, sy: 4.0, sz: 0.2 },
      { x: 5.05, y: 2.1, z: -3.2, sx: 0.2, sy: 4.0, sz: 0.2 },
      { x: 5.05, y: 2.1, z: -1.2, sx: 0.2, sy: 4.0, sz: 0.2 },
      { x: 4.62, y: 2.5, z: -2.2, sx: 1.1, sy: 0.16, sz: 2.2 },
      { x: 4.62, y: 4.0, z: -2.2, sx: 1.1, sy: 0.16, sz: 2.2 },
      { x: 4.2, y: 4.8, z: -2.2, sx: 1.45, sy: 0.18, sz: 0.2 },
      // Ladder rungs on right scaffolding
      { x: 5.08, y: 1.3, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 1.9, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 2.5, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      { x: 5.08, y: 3.1, z: -2.2, sx: 0.12, sy: 0.12, sz: 0.75 },
      // Left manor small scaffolding
      { x: -3.0, y: 1.7, z: -0.6, sx: 0.18, sy: 2.4, sz: 0.18 },
      { x: -3.0, y: 1.7, z: 0.8, sx: 0.18, sy: 2.4, sz: 0.18 },
      { x: -2.6, y: 2.4, z: 0.1, sx: 0.9, sy: 0.15, sz: 1.6 },
    ];

    // 5. Lush Voxel Trees & Shrubs
    const trunkSpecs: VoxelSpec[] = [
      { x: -4.0, y: 1.1, z: -1.6, sx: 0.48, sy: 1.6, sz: 0.48 },
      { x: -3.8, y: 1.0, z: 2.2, sx: 0.44, sy: 1.3, sz: 0.44 },
      { x: 3.8, y: 1.0, z: 2.5, sx: 0.44, sy: 1.3, sz: 0.44 },
    ];
    const pineSpecs: VoxelSpec[] = [
      { x: -4.0, y: 2.3, z: -1.6, sx: 1.7, sy: 0.9, sz: 1.7 },
      { x: -4.0, y: 3.15, z: -1.6, sx: 1.25, sy: 0.85, sz: 1.25 },
      { x: -4.0, y: 3.9, z: -1.6, sx: 0.7, sy: 0.75, sz: 0.7 },
      { x: -3.8, y: 2.0, z: 2.2, sx: 1.5, sy: 0.85, sz: 1.5 },
      { x: -3.8, y: 2.75, z: 2.2, sx: 0.95, sy: 0.8, sz: 0.95 },
      { x: 3.8, y: 2.0, z: 2.5, sx: 1.5, sy: 0.85, sz: 1.5 },
      { x: 3.8, y: 2.75, z: 2.5, sx: 0.95, sy: 0.8, sz: 0.95 },
    ];

    islandGroup.add(buildVoxelInstances(boxGeo, grassMat, grassSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, mossMat, mossSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, dirtMat, dirtSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneLightMat, stoneLightSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneMidMat, stoneMidSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneDarkMat, stoneDarkSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkWoodMat, [...timberSpecs, ...trunkSpecs]));
    islandGroup.add(buildVoxelInstances(boxGeo, woodMat, scaffSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, roofMat, roofSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, pineMat, pineSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, crystalMat, windowSpecs, false, false));
    islandGroup.add(
      buildVoxelInstances(
        boxGeo,
        lanternMat,
        [
          ...porchSpecs,
          { x: -1.85, y: 1.35, z: 2.35, sx: 0.28, sy: 0.36, sz: 0.28 },
          { x: -0.15, y: 1.35, z: 2.35, sx: 0.28, sy: 0.36, sz: 0.28 },
          { x: 2.1, y: 3.2, z: -2.2, sx: 0.35, sy: 0.35, sz: 0.35 },
        ],
        false,
        false,
      ),
    );

    // Distant floating background islands
    const bgIslands = new THREE.Group();
    bgIslands.add(
      buildVoxelInstances(
        boxGeo,
        grassMat,
        [
          { x: -14, y: 2.5, z: -16, sx: 3.5, sy: 0.7, sz: 3.5 },
          { x: 15, y: 1.5, z: -17, sx: 2.8, sy: 0.65, sz: 2.8 },
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
          { x: -14, y: 1.4, z: -16, sx: 2.4, sy: 1.6, sz: 2.4 },
          { x: 15, y: 0.6, z: -17, sx: 1.9, sy: 1.2, sz: 1.9 },
        ],
        false,
        false,
      ),
    );
    scene.add(bgIslands);

    // Dual-color floating violet + warm gold fireflies
    const makeMotes = (color: number, count: number) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 16;
        pos[i * 3 + 1] = Math.random() * 9 - 2.5;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.16, transparent: true, opacity: 0.88 }));
    };
    scene.add(makeMotes(0xd8bfff, 38));
    scene.add(makeMotes(0xffcb77, 24));

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
      islandGroup.position.y = Math.sin(t * 1.0) * 0.12;
      crystalLight.intensity = 5.6 + Math.sin(t * 3.0) * 0.9;

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

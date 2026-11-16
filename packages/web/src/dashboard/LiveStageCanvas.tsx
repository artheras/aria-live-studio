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
 * 1:1 3D Voxel Castle-Workshop Diorama matching the reference artwork:
 * - Jagged 11x11 floating rocky island with front stone stair entry
 * - Two-story stone & timber manor with tall glowing purple windows & warm porch
 * - Tall square castle watchtower with battlements + right-side wooden scaffolding
 * - Twilight sky gradient dome, UnrealBloomPass HDR glow, OrbitControls & 3D labels
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
    scene.fog = new THREE.FogExp2(0x2d2142, 0.015);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 150);
    camera.position.set(14.5, 10.2, 15.5);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.45, 0.78));
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.38;
    controls.minDistance = 9;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0.2, 2.2, 0);

    // Twilight sky dome matching Image 1 (deep violet top -> lavender mid -> warm sunset horizon)
    const skyGeo = new THREE.SphereGeometry(72, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x1b1533) },
        midColor: { value: new THREE.Color(0x5b3c79) },
        horizonColor: { value: new THREE.Color(0xe6ab82) },
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
    scene.add(new THREE.HemisphereLight(0xd1b3ff, 0x261c38, 1.1));

    const sun = new THREE.DirectionalLight(0xffcfa0, 2.25);
    sun.position.set(14, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 45;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x9146ff, 0.95);
    rim.position.set(-12, 6, -12);
    scene.add(rim);

    const crystalLight = new THREE.PointLight(0x9146ff, 6.0, 12);
    crystalLight.position.set(0, 3.2, 1.2);
    scene.add(crystalLight);

    const porchLight = new THREE.PointLight(0xffb44c, 4.8, 8);
    porchLight.position.set(-0.4, 1.4, 2.8);
    scene.add(porchLight);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const boxGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6e6a7c, roughness: 0.86 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x453f52, roughness: 0.92 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x564136, roughness: 0.94 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4f8a59, roughness: 0.8 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x316b43, roughness: 0.82 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x99633a, roughness: 0.78 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x5a3922, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3c3448, roughness: 0.74 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xdcbcff,
      emissive: 0x9146ff,
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe6a6,
      emissive: 0xffa62b,
      emissiveIntensity: 2.6,
      roughness: 0.15,
    });

    // 1. Sculpted 11x11 jagged floating island base + stepped front-left stone stairs
    const grassSpecs: VoxelSpec[] = [];
    const dirtSpecs: VoxelSpec[] = [];
    const rockSpecs: VoxelSpec[] = [];
    const stoneSpecs: VoxelSpec[] = [];

    for (let x = -5; x <= 5; x++) {
      for (let z = -5; z <= 5; z++) {
        const dist = Math.abs(x) + Math.abs(z);
        if (dist > 7) continue;
        // Raised stone terrace under castle
        const onTerrace = x >= -2 && x <= 3 && z >= -3 && z <= 1;
        if (onTerrace) {
          stoneSpecs.push({ x, y: 0.5, z });
        } else {
          grassSpecs.push({ x, y: 0, z });
        }
        if (dist <= 6) dirtSpecs.push({ x, y: -1, z });
        if (dist <= 4) rockSpecs.push({ x, y: -2, z });
        if (dist <= 3) rockSpecs.push({ x, y: -3, z });
        if (dist <= 1) rockSpecs.push({ x, y: -4, z });
      }
    }
    rockSpecs.push({ x: 0, y: -5, z: 0 });
    // Front stone stairs leading up to the manor porch
    stoneSpecs.push(
      { x: -1, y: 0.15, z: 4, sx: 1.6, sy: 0.35, sz: 0.9 },
      { x: -1, y: 0.45, z: 3, sx: 1.6, sy: 0.45, sz: 0.9 },
      { x: -1, y: 0.75, z: 2, sx: 1.6, sy: 0.55, sz: 0.9 },
    );

    // 2. Main Gabled Stone & Timber Manor (left-center)
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
            windowSpecs.push({ x, y, z });
          } else if (isCorner) {
            timberSpecs.push({ x, y, z });
          } else {
            stoneSpecs.push({ x, y, z });
          }
        }
      }
    }
    // Manor stepped pitched roof
    for (let z = -2.5; z <= 1.5; z += 1) {
      for (let x = -2.5; x <= 1.5; x += 1) {
        roofSpecs.push({ x, y: 4.3, z, sx: 0.95, sy: 0.65, sz: 0.95 });
      }
      for (let x = -1.5; x <= 0.5; x += 1) {
        roofSpecs.push({ x, y: 4.95, z, sx: 0.95, sy: 0.65, sz: 0.95 });
      }
      roofSpecs.push({ x: -0.5, y: 5.6, z, sx: 0.95, sy: 0.65, sz: 0.95 });
    }
    // Glowing upper gable crystal window
    windowSpecs.push({ x: -0.5, y: 4.95, z: 1.6, sx: 0.85, sy: 0.85, sz: 0.4 });

    // 3. Tall Square Castle Watchtower (back-right, matching Image 1!)
    for (let y = 1.5; y <= 6.5; y += 1) {
      for (let x = 1.5; x <= 3.5; x += 1) {
        for (let z = -3.5; z <= -1.5; z += 1) {
          const isTowerWin = y === 5.5 && ((z === -1.5 && x === 2.5) || (x === 1.5 && z === -2.5));
          if (isTowerWin) windowSpecs.push({ x, y, z });
          else stoneSpecs.push({ x, y, z });
        }
      }
    }
    // Castle battlements at top of watchtower
    for (let x = 1.5; x <= 3.5; x += 1) {
      for (let z = -3.5; z <= -1.5; z += 1) {
        if (x === 2.5 && z === -2.5) continue;
        if ((Math.round(x * 2) + Math.round(z * 2)) % 2 === 0) {
          stoneSpecs.push({ x, y: 7.3, z, sx: 0.85, sy: 0.6, sz: 0.85 });
        }
      }
    }

    // 4. Multi-level Wooden Scaffolding on the right side of the tower
    const scaffSpecs: VoxelSpec[] = [
      { x: 4.2, y: 2.0, z: -3.2, sx: 0.2, sy: 3.8, sz: 0.2 },
      { x: 4.2, y: 2.0, z: -1.2, sx: 0.2, sy: 3.8, sz: 0.2 },
      { x: 5.0, y: 2.0, z: -3.2, sx: 0.2, sy: 3.8, sz: 0.2 },
      { x: 5.0, y: 2.0, z: -1.2, sx: 0.2, sy: 3.8, sz: 0.2 },
      { x: 4.6, y: 2.4, z: -2.2, sx: 1.1, sy: 0.16, sz: 2.2 },
      { x: 4.6, y: 3.9, z: -2.2, sx: 1.1, sy: 0.16, sz: 2.2 },
      { x: 4.2, y: 4.6, z: -2.2, sx: 1.4, sy: 0.18, sz: 0.2 },
    ];

    // 5. Lush Voxel Trees on left & right terraces
    const trunkSpecs: VoxelSpec[] = [
      { x: -3.8, y: 1.1, z: -1.5, sx: 0.48, sy: 1.6, sz: 0.48 },
      { x: -3.6, y: 1.0, z: 2.2, sx: 0.44, sy: 1.3, sz: 0.44 },
      { x: 3.8, y: 1.0, z: 2.4, sx: 0.44, sy: 1.3, sz: 0.44 },
    ];
    const pineSpecs: VoxelSpec[] = [
      { x: -3.8, y: 2.3, z: -1.5, sx: 1.7, sy: 0.9, sz: 1.7 },
      { x: -3.8, y: 3.15, z: -1.5, sx: 1.25, sy: 0.85, sz: 1.25 },
      { x: -3.8, y: 3.9, z: -1.5, sx: 0.7, sy: 0.75, sz: 0.7 },
      { x: -3.6, y: 2.0, z: 2.2, sx: 1.5, sy: 0.85, sz: 1.5 },
      { x: -3.6, y: 2.75, z: 2.2, sx: 0.95, sy: 0.8, sz: 0.95 },
      { x: 3.8, y: 2.0, z: 2.4, sx: 1.5, sy: 0.85, sz: 1.5 },
      { x: 3.8, y: 2.75, z: 2.4, sx: 0.95, sy: 0.8, sz: 0.95 },
    ];

    islandGroup.add(buildVoxelInstances(boxGeo, grassMat, grassSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, dirtMat, dirtSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkStoneMat, rockSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, stoneMat, stoneSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkWoodMat, [...timberSpecs, ...trunkSpecs]));
    islandGroup.add(buildVoxelInstances(boxGeo, woodMat, scaffSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, roofMat, roofSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, pineMat, pineSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, crystalMat, windowSpecs, false, false));
    islandGroup.add(buildVoxelInstances(boxGeo, lanternMat, [...porchSpecs, { x: -0.2, y: 1.3, z: 2.2, sx: 0.28, sy: 0.36, sz: 0.28 }], false, false));

    // Distant floating background islands for twilight parallax
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
        darkStoneMat,
        [
          { x: -14, y: 1.4, z: -16, sx: 2.4, sy: 1.6, sz: 2.4 },
          { x: 15, y: 0.6, z: -17, sx: 1.9, sy: 1.2, sz: 1.9 },
        ],
        false,
        false,
      ),
    );
    scene.add(bgIslands);

    // Floating glowing violet & gold ember motes
    const moteCount = 56;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 16;
      motePos[i * 3 + 1] = Math.random() * 9 - 2.5;
      motePos[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({ color: 0xd8bfff, size: 0.16, transparent: true, opacity: 0.85 });
    scene.add(new THREE.Points(moteGeo, moteMat));

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
      new THREE.Vector3(3.2, 6.2, 0.4),
      new THREE.Vector3(-2.4, 5.6, -2.4),
      new THREE.Vector3(2.4, 4.6, 2.8),
    ];
    const builderAnchors = [
      new THREE.Vector3(-2.2, 1.8, 3.0),
      new THREE.Vector3(2.2, 1.8, 3.0),
      new THREE.Vector3(4.6, 4.2, -2.2),
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
      crystalLight.intensity = 5.4 + Math.sin(t * 3.0) * 0.9;

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

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
 * Real interactive 3D Three.js Voxel Workshop:
 * - Drag 360° with OrbitControls, scroll to zoom
 * - Soft shadows, glowing Twitch-violet crystal windows, warm doorway lantern
 * - 3D-projected live !idea speech bubbles & Co-Builder flags
 * - Safe no-op fallback in headless/jsdom environments without WebGL
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x110f1d);
    scene.fog = new THREE.FogExp2(0x110f1d, 0.032);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(11.5, 8.8, 12.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    controls.minDistance = 7;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 1.4, 0);

    // Lighting: twilight hemisphere + warm amber sun + violet window crystal + doorway lantern
    const hemi = new THREE.HemisphereLight(0xb589ff, 0x1b172b, 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffcfa0, 1.85);
    sun.position.set(10, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 36;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    scene.add(sun);

    const crystalLight = new THREE.PointLight(0x9146ff, 4.5, 9);
    crystalLight.position.set(0, 2.5, 0.4);
    scene.add(crystalLight);

    const lanternLight = new THREE.PointLight(0xffb84d, 3.2, 6);
    lanternLight.position.set(0.8, 1.4, 2.3);
    scene.add(lanternLight);

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5c5b6e, roughness: 0.88 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x3b384a, roughness: 0.92 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x457d54, roughness: 0.82 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a36, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2f3142, roughness: 0.72 });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xc89eff,
      emissive: 0x9146ff,
      emissiveIntensity: 1.7,
      roughness: 0.25,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe099,
      emissive: 0xffa62b,
      emissiveIntensity: 1.9,
      roughness: 0.2,
    });

    // 1. Floating island base (7x7 grass top + tapered stone underside)
    const grassSpecs: VoxelSpec[] = [];
    const underSpecs: VoxelSpec[] = [];
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        const corner = Math.abs(x) === 3 && Math.abs(z) === 3;
        if (corner) continue;
        grassSpecs.push({ x, y: 0, z });
        if (Math.abs(x) <= 2 && Math.abs(z) <= 2) {
          underSpecs.push({ x, y: -1, z });
        }
        if (Math.abs(x) <= 1 && Math.abs(z) <= 1) {
          underSpecs.push({ x, y: -2, z });
        }
      }
    }
    underSpecs.push({ x: 0, y: -3, z: 0 });
    islandGroup.add(buildVoxelInstances(boxGeo, grassMat, grassSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, darkStoneMat, underSpecs));

    // 2. Workshop stone walls + front steps
    const wallSpecs: VoxelSpec[] = [];
    const windowSpecs: VoxelSpec[] = [];
    for (let y = 1; y <= 2; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          const isWin = y === 1 && ((x === -1 && z === 0) || (x === 0 && z === 1));
          if (isWin) windowSpecs.push({ x, y, z });
          else wallSpecs.push({ x, y, z });
        }
      }
    }
    // Stone steps in front
    wallSpecs.push({ x: 0, y: 0.6, z: 2, sx: 1, sy: 0.4, sz: 0.8 });
    islandGroup.add(buildVoxelInstances(boxGeo, stoneMat, wallSpecs));
    islandGroup.add(buildVoxelInstances(boxGeo, crystalMat, windowSpecs, false, false));

    // 3. Pitched roof & chimney
    const roofSpecs: VoxelSpec[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        roofSpecs.push({ x, y: 3, z });
      }
    }
    roofSpecs.push({ x: 0, y: 4, z: -1 }, { x: 0, y: 4, z: 0 }, { x: 0, y: 4, z: 1 });
    islandGroup.add(buildVoxelInstances(boxGeo, roofMat, roofSpecs));

    // 4. Timber scaffolding (right side) + trees (left side) + lantern
    const woodSpecs: VoxelSpec[] = [
      { x: 2, y: 1, z: 0, sx: 0.22, sy: 1.1, sz: 0.22 },
      { x: 2, y: 2, z: 0, sx: 0.22, sy: 1.1, sz: 0.22 },
      { x: 2, y: 1, z: 1, sx: 0.22, sy: 1.1, sz: 0.22 },
      { x: 2, y: 2, z: 1, sx: 0.22, sy: 1.1, sz: 0.22 },
      { x: 2, y: 2.4, z: 0.5, sx: 0.9, sy: 0.16, sz: 1.4 },
      { x: -2, y: 1, z: -1, sx: 0.45, sy: 1, sz: 0.45 },
      { x: -2, y: 1, z: 2, sx: 0.45, sy: 1, sz: 0.45 },
    ];
    islandGroup.add(buildVoxelInstances(boxGeo, woodMat, woodSpecs));

    const leafSpecs: VoxelSpec[] = [
      { x: -2, y: 2, z: -1, sx: 1.15, sy: 0.9, sz: 1.15 },
      { x: -2, y: 2.8, z: -1, sx: 0.75, sy: 0.8, sz: 0.75 },
      { x: -2, y: 2, z: 2, sx: 1.05, sy: 0.85, sz: 1.05 },
      { x: -2, y: 2.7, z: 2, sx: 0.65, sy: 0.7, sz: 0.65 },
    ];
    islandGroup.add(buildVoxelInstances(boxGeo, grassMat, leafSpecs));

    islandGroup.add(buildVoxelInstances(boxGeo, lanternMat, [{ x: 0.75, y: 1.35, z: 1.65, sx: 0.3, sy: 0.4, sz: 0.3 }], false, false));

    // Crystal spire at the top (pulses when executing or level >= 2)
    const spireMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), crystalMat);
    spireMesh.position.set(0, 5.1, 0);
    islandGroup.add(spireMesh);

    // Floating ambient motes
    const moteCount = 36;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 12;
      motePos[i * 3 + 1] = Math.random() * 7 - 1.5;
      motePos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({ color: 0xc89eff, size: 0.14, transparent: true, opacity: 0.75 });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // 3D Firework particle cubes
    const bursts: BurstCube[] = [];
    const burstGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    burstFnRef.current = (colorHex: number) => {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 1.6 });
      for (let i = 0; i < 18; i++) {
        const mesh = new THREE.Mesh(burstGeo, mat);
        mesh.position.set(0, 3.8, 0);
        scene.add(mesh);
        const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 0.06 + Math.random() * 0.08;
        bursts.push({
          mesh,
          vx: Math.cos(ang) * spd,
          vy: 0.1 + Math.random() * 0.09,
          vz: Math.sin(ang) * spd,
          life: 48,
        });
      }
    };

    const ideaAnchors = [
      new THREE.Vector3(-2.4, 3.6, 1.4),
      new THREE.Vector3(2.4, 4.1, 0.8),
      new THREE.Vector3(-1.8, 4.5, -1.6),
      new THREE.Vector3(1.8, 3.4, -1.8),
    ];
    const builderAnchors = [
      new THREE.Vector3(2.5, 1.4, -2.0),
      new THREE.Vector3(-2.5, 1.4, -2.2),
      new THREE.Vector3(2.5, 1.4, 2.2),
    ];

    const ro = typeof ResizeObserver !== "undefined"
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
    const vec = new THREE.Vector3();

    const animate = () => {
      frame += 1;
      const t = frame * 0.016;
      islandGroup.position.y = Math.sin(t * 1.1) * 0.12;
      spireMesh.rotation.y = t * 0.9;
      spireMesh.position.y = 5.05 + Math.sin(t * 2.2) * 0.14;
      crystalLight.intensity = 4.2 + Math.sin(t * 3.1) * 0.7;

      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]!;
        b.mesh.position.x += b.vx;
        b.mesh.position.y += b.vy;
        b.mesh.position.z += b.vz;
        b.vy -= 0.004;
        b.mesh.rotation.x += 0.1;
        b.mesh.rotation.y += 0.12;
        b.life -= 1;
        const s = Math.max(0.01, b.life / 48);
        b.mesh.scale.setScalar(s);
        if (b.life <= 0) {
          scene.remove(b.mesh);
          bursts.splice(i, 1);
        }
      }

      controls.update();
      renderer.render(scene, camera);

      // Update 3D-projected HTML labels every 2 frames to keep React overhead near zero
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

import * as THREE from "three";

export interface VoxelSpec {
  x: number;
  y: number;
  z: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export function buildVoxelInstances(
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

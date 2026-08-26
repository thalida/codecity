// Scene-graph queries shared by the component tests. Group names come from the
// components that set them, so no test repeats a name literal.

import * as THREE from 'three';

/** Direct Mesh children of `group` (InstancedMesh included). */
export function meshChildren(group: THREE.Object3D): THREE.Mesh[] {
  return group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);
}

/** The named child group, or null when the component has not built it. */
export function childGroup(parent: THREE.Object3D, name: string): THREE.Object3D | null {
  return parent.children.find((c) => c.name === name) ?? null;
}

/** Direct Mesh children of the named child group; empty when absent. */
export function meshesInChildGroup(parent: THREE.Object3D, name: string): THREE.Mesh[] {
  const group = childGroup(parent, name);
  return group ? meshChildren(group) : [];
}

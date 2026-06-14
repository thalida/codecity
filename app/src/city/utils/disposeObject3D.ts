// city/utils/disposeObject3D.ts — per-Object3D GPU resource disposer.
// Frees geometry + materials (array-aware) + any Texture-valued material
// property. Honors two userData flags: `disposed` (idempotency — never double-
// frees) and `sharedMaterial` (skips material disposal for meshes that share a
// module-owned material, e.g. the building cell detail meshes — freeing it would
// blank every building). Safe for unshared meshes (no flag → material disposes
// normally). Pass to Object3D.traverse() to dispose a whole subtree.
import type * as THREE from 'three';

export function disposeObject3D(obj: THREE.Object3D | null): void {
  if (!obj || obj.userData?.disposed) return;
  // Disposable shape: any object that may carry .geometry / .material
  // (Mesh, Line, LineSegments2, Group). Use a structural cast since
  // this disposer is intentionally generic across all of them.
  interface DisposableObj {
    geometry?: { dispose?: () => void };
    material?:
      | { dispose?: () => void; [k: string]: unknown }
      | Array<{ dispose?: () => void; [k: string]: unknown }>;
  }
  const d = obj as unknown as DisposableObj;
  if (d.geometry?.dispose) d.geometry.dispose();
  // Skip material disposal for meshes whose material is module-owned and
  // shared across cell tiles (cellMesh.ts factory).
  if (!obj.userData?.sharedMaterial) {
    const mats = Array.isArray(d.material) ? d.material : d.material ? [d.material] : [];
    for (const m of mats) {
      if (!m) continue;
      // Dispose any texture attached to this material.
      for (const key in m) {
        if (!Object.hasOwn(m, key)) continue;
        const v = m[key] as { isTexture?: boolean; dispose?: () => void } | undefined;
        if (v?.isTexture && typeof v.dispose === 'function') v.dispose();
      }
      if (typeof m.dispose === 'function') m.dispose();
    }
  }
  if (obj.userData) obj.userData.disposed = true;
}

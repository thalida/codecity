// city/utils/disposeObject3D.ts — frees an Object3D's geometry, materials and
// their textures; pass it to traverse() for a whole subtree. userData flags:
// `disposed` for idempotency, `sharedGeometry` / `sharedMaterial` to leave a
// resource to its owner, since freeing it here would blank the other holders.
import type * as THREE from 'three';

export function disposeObject3D(obj: THREE.Object3D | null): void {
  if (!obj || obj.userData?.disposed) return;
  // Structural cast: this is deliberately generic over anything that may carry
  // .geometry / .material (Mesh, Line, LineSegments2, Group).
  interface DisposableObj {
    geometry?: { dispose?: () => void };
    material?:
      | { dispose?: () => void; [k: string]: unknown }
      | Array<{ dispose?: () => void; [k: string]: unknown }>;
  }
  const d = obj as unknown as DisposableObj;
  if (d.geometry?.dispose && !obj.userData?.sharedGeometry) d.geometry.dispose();
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

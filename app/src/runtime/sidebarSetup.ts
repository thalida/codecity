// runtime/sidebarSetup.ts — No-op stub.
//
// Both sidebars are now self-contained Preact components that read
// SCENE_HANDLE directly. App.tsx mounts them as JSX. Nothing needs
// imperative setup here — kept as a no-op (and called from boot.ts)
// to preserve the existing dispose-bag flow until the boot
// orchestrator is simplified.

import type { Manifest } from '../types';
import type { SceneHandle } from './manifestStream';

export interface SidebarSetupResult {
  dispose(): void;
}

export function setupSidebars(
  _handle: SceneHandle,
  _initialManifest: Manifest
): SidebarSetupResult {
  return { dispose() {} };
}

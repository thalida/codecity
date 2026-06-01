// state/stores/scene.ts — Runtime signal that holds the Three.js scene
// handle once CenterPane mounts and startRenderLoop completes. Components
// that need world / picker / rig read SCENE_HANDLE.value?.world etc.
// Null until CenterPane's useEffect resolves.

import { signal } from '@preact/signals';
import type { startRenderLoop } from '../../scene/renderLoop';

export type SceneHandle = Awaited<ReturnType<typeof startRenderLoop>>;

export const SCENE_HANDLE = signal<SceneHandle | null>(null);

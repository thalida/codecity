// city/cityParts.ts — what the composer hands the City class.
//
// Internal. The composer wires forty locals to each other; this is the tidy
// handover, so that City itself reads as an API rather than as the tail of a
// build script.

import type * as THREE from 'three';

import type { Picker } from './interaction/picker';
import type { CameraRig, FocusMode } from './render/cameraRig';
import type { CitySettingsStore } from './settings/store';
import type { CodecityClient } from './client/index';
import type { CityEmitter } from './state/events';
import type { CityStatusTracker } from './state/status';
import type { CityChangeHub } from './state/change';
import type { CityState } from './state';
import type { SourceLoader } from './data/loadSource';
import type { TimelineLoader } from './data/loadTimeline';
import type { WatchDeps } from './data/watch';
import type { BuildStage } from './types/build';
import type { Manifest } from './types/manifest';
import type { CityTimeline, CityWorld, FocusRef } from './types';

export interface CityParts {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  picker: Picker;
  rig: CameraRig;
  client: CodecityClient;
  settings: CitySettingsStore;
  events: CityEmitter;
  status: CityStatusTracker;
  changes: CityChangeHub;
  cityState: CityState;
  timeline: CityTimeline;
  sourceLoader: SourceLoader;
  timelineLoader: TimelineLoader;
  watchDeps: WatchDeps;
  world: CityWorld;
  focus(ref: FocusRef, mode?: FocusMode): boolean;
  applyManifest(m: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  buildStagesFor(m: Manifest): BuildStage[];
  invalidateLayoutCache(): void;
  teardown(): void;
}

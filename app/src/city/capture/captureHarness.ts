// city/capture/captureHarness.ts — debug-only. With ?shot=<name>, wait for the
// first render, pose the camera, let the tween settle, then mark
// <html data-cc-capture-ready="1"> for the screenshot script. Lazy-loaded from
// main.tsx only when ?shot is present, so it never ships in a normal session.

import { effect } from '@preact/signals';

import { isDebugMode } from '@/utils/debugMode';
import { SCENE_HANDLE } from '@/city/sceneHandle';
import { MANIFEST } from '@/state/stores/manifest';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/progress';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

import { SHOTS, type ShotOverrides } from './shots';

// Camera tween + bloom ramp + ad-panel texture fades all settle well under this.
const SETTLE_MS = 2200;
// Retry a not-yet-ready shot (trees still placing, timeline still fetching)
// this often, up to a cap (~48s) that covers a big repo.
const POSE_RETRY_MS = 400;
const MAX_POSE_ATTEMPTS = 120;

export function initCaptureHarness(): void {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (!shot || !isDebugMode()) return;

  const pose = SHOTS[shot];
  if (!pose) {
    console.warn(`[capture] unknown shot "${shot}"; known: ${Object.keys(SHOTS).join(', ')}`);
    return;
  }

  // Chrome off for the whole session: the screenshot is of the canvas, and
  // anything floating over it lands in the file (see App.css).
  document.getElementById('app')?.classList.add('cc-capture');

  // Optional live tuning: ?elev=&az=&dist= override the shot's baked angles.
  const num = (key: string): number | undefined => {
    const raw = params.get(key);
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const overrides: ShotOverrides = { elev: num('elev'), az: num('az'), dist: num('dist') };

  let posed = false;
  const stop = effect(() => {
    const handle = SCENE_HANDLE.value;
    const manifest = MANIFEST.value as Manifest;
    if (
      posed ||
      !handle ||
      isEmptyManifest(manifest) ||
      REBUILD_STATUS.value !== RebuildStatus.Idle
    )
      return;
    // A skeleton also reaches Idle, and framing on its root-street bbox locks
    // onto a close-up. Reading anchors subscribes to bbox, so this re-fires.
    if (handle.rig.captureAnchors().tallestHeight <= 0) return;
    posed = true;
    const h = handle; // non-null past the guard

    // Pose OUTSIDE the tracking scope: it writes CAMERA, and a signal write in
    // the sync scope would cycle. A shot returns false until its target lands.
    queueMicrotask(() => {
      stop();
      let attempts = 0;
      const tryPose = () => {
        let ready = true;
        try {
          ready = pose(h, MANIFEST.peek() as Manifest, overrides) !== false;
        } catch (err) {
          console.error(`[capture] shot "${shot}" pose failed`, err);
        }
        attempts += 1;
        if (ready || attempts >= MAX_POSE_ATTEMPTS) {
          window.setTimeout(() => {
            document.documentElement.dataset.ccCaptureReady = '1';
          }, SETTLE_MS);
        } else {
          window.setTimeout(tryPose, POSE_RETRY_MS);
        }
      };
      tryPose();
    });
  });
}

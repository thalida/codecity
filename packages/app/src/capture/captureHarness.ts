// capture/captureHarness.ts — debug-only. With ?shot=<name>, pose the camera on
// the city it is handed, let the tween settle, then mark
// <html data-cc-capture-ready="1"> for the screenshot script. Lazy-loaded only
// when ?shot is present, so it never ships in a normal session.

import type { City, Manifest } from '@codecity/city';

import { isDebugMode } from '@/utils/debugMode';
import { CityLifecycle } from '@codecity/city';

import { SHOTS, type ShotOverrides } from './shots';

// Camera tween + bloom ramp + ad-panel texture fades all settle well under this.
const SETTLE_MS = 2200;
// Retry a not-yet-ready shot (trees still placing, timeline still fetching)
// this often, up to a cap (~48s) that covers a big repo.
const POSE_RETRY_MS = 400;
const MAX_POSE_ATTEMPTS = 120;

/** Pose one city for a screenshot. Called by the view that built it: a shot is
 *  of a particular city, and this is a dev tool, not a second owner of one. */
export function captureCity(city: City): void {
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
  const consider = (): void => {
    // On screen AND final: a shot of a city still growing trees is a shot of a
    // different city from the one it will be a second later.
    if (posed || !city.manifest) return;
    if (city.status.lifecycle !== CityLifecycle.Ready || city.status.fetching) return;
    // A skeleton also reaches Ready, and framing on its root-street bbox locks
    // onto a close-up.
    if (city.rig.captureAnchors().tallestHeight <= 0) return;
    posed = true;
    const h = city;

    queueMicrotask(() => {
      stop();
      let attempts = 0;
      const tryPose = () => {
        let ready = true;
        try {
          ready = pose(h, h.manifest as Manifest, overrides) !== false;
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
  };

  const stop = city.onStatus(consider);
  consider();
}

// config/live.js — Live-update polling. When ENABLED, the frontend
// re-fetches /api/manifest every POLL_SECONDS and reloads the page when
// the manifest's signature changes — i.e. the underlying tree's mtime
// or size state shifted.
//
// User-tunable; default OFF so the tool stays cheap when nobody's
// actively editing files. Bounds for POLL_SECONDS are clamped at the
// caller (see main.js#_clampPollSeconds) so an overly aggressive value
// can't ddos the local server, and an absurdly large one can't disable
// the feature in disguise.

import { map } from 'nanostores';

export interface LiveUpdatesConfig {
  ENABLED: boolean;
  POLL_SECONDS: number;
}

export const LIVE_UPDATES = map<LiveUpdatesConfig>({
  ENABLED: false,
  POLL_SECONDS: 10,
});

// Hidden bounds (not exposed in the controls UI, just clamped on read).
// 1s is the floor — the server has to do a real filesystem walk on each
// poll, so anything tighter just burns CPU with no perceptible win.
// 60s is the ceiling — beyond that the "live" framing stops feeling live.
export const POLL_SECONDS_MIN = 1;
export const POLL_SECONDS_MAX = 60;

// Note: the in-flight rebuild-status atom intentionally lives OUTSIDE
// this barrel — it's transient runtime state, not a user-tunable
// config, so it must not be picked up by attachPersistence(Config).
// See app/liveStatus.ts.

// config/sky.ts — Cyberpunk Valley sky configuration. Two nanostore
// map()s drive the procedural sky shader's uniforms via the
// `applyTheme()` path — applied on Save (see configCommitReactions.ts).
//
//   SKY       — flat backdrop. COLOR fills the entire sphere — the
//                world floor mesh handles real ground, so past its
//                edge the camera sees the sky color directly and the
//                plane reads as floating in space. The icosphere is
//                always rendered.
//   SKY_STARS — hashed point-star field rendered across the full
//                sphere (including below the horizon line).

import { map } from 'nanostores';

export interface SkyConfig {
  COLOR: string;
}

export const SKY = map<SkyConfig>({
  // Near-black with a faint plum cast — reads as deep space, not pure
  // black, so HDR-bloomed buildings and stars retain contrast.
  COLOR: '#010005',
});

export interface SkyStarsConfig {
  ENABLED: boolean;
  DENSITY: number;
  SIZE: number;
  BRIGHTNESS: number;
  TWINKLE_ENABLED: boolean;
  TWINKLE_SPEED: number;
  TWINKLE_AMPLITUDE: number;
}

export const SKY_STARS = map<SkyStarsConfig>({
  ENABLED: true,
  // 0.0075 — user-tuned default that lands ~680 stars across the
  // upper hemisphere. With stars now drawn across the full sphere
  // (no min-elevation cutoff) this roughly doubles to ~1360 visible
  // candidates. Dense enough to read as a starry night, sparse
  // enough to keep individual stars distinct. Stars are rendered as
  // small circular sub-cell dots (see SIZE) so the per-cell scale
  // can stay coarse without making each star huge.
  DENSITY: 0.0075,
  // Star spot radius as a fraction of the cell. 0.15 = each star
  // occupies a circle ~15% of the cell's width, with a smoothstep
  // antialiased edge. Larger values = chunkier stars.
  SIZE: 0.15,
  BRIGHTNESS: 1.2,
  TWINKLE_ENABLED: true,
  TWINKLE_SPEED: 0.5,
  TWINKLE_AMPLITUDE: 1.0,
});

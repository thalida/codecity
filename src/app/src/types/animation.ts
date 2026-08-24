// types/animation.ts — discriminants for the per-frame tween/fade system.

/**
 * What property an animator tween targets. 'scaleY' keeps a separate
 * tween from 'position' so the two never fight each other on the same
 * mesh (animator only ever runs one of each kind per mesh at a time).
 */
export enum TweenKind {
  ScaleY = 'scaleY',
  Position = 'position',
}

/**
 * How much detail a building shows in the current fade tier:
 *   Full       — textured walls + windows + doors
 *   Silhouette — solid-color box (no texture cost)
 *   Hidden     — body invisible (only outline can show)
 */
export enum FadeDetail {
  Full = 'full',
  Silhouette = 'silhouette',
  Hidden = 'hidden',
}

// city/components/repoLabel/bounds.ts — the label panel's world box, from the
// repo name and the settings alone. Pure and mesh-free on purpose: the camera
// framing runs before the label is armed, and framing that waits for a mesh
// frames a different city than R does (issue #62).

import { aspectForName } from './textCanvas';
import type { RepoLabelConfig } from '../../settings/fields/gem';
import type { BuildingDimensionsConfig } from '../../settings/fields/buildings';

export interface RepoLabelBounds {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfWidth: number;
  halfHeight: number;
}

/** Null when there is no label to frame: disabled, or no repo name yet. */
export function repoLabelBounds(
  name: string | null | undefined,
  anchor: { x: number; y: number; z: number } | null,
  cfg: RepoLabelConfig,
  dims: BuildingDimensionsConfig
): RepoLabelBounds | null {
  if (!cfg.ENABLED || !name || !anchor) return null;
  const halfFont = cfg.FONT_SIZE / 2;
  const maxBldgH = dims.MAX_FLOORS * dims.FLOOR_HEIGHT;
  const heightWorld = maxBldgH * (cfg.HEIGHT_PCT / 100);
  return {
    centerX: anchor.x,
    // Mirrors _applyTransform: the panel centre sits a half-font above the
    // beam's top, and the group's x/z is the anchor's.
    centerY: anchor.y + heightWorld + halfFont,
    centerZ: anchor.z,
    halfWidth: (cfg.FONT_SIZE * aspectForName(name)) / 2,
    halfHeight: halfFont,
  };
}

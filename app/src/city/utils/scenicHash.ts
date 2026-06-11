// city/utils/scenicHash.ts — pure scenic-config-hash computation extracted
// from world.ts. Snapshots the current values of every config store whose
// output is BAKED into buildWorld meshes (street geometry/color, sidewalk
// color, label typography, gem appearance). applyManifest compares this hash
// across applies to decide whether a layout-cache hit can also reuse the
// existing scenic meshes — the gate logic itself stays in world.applyManifest.

import { SCENE } from '@/state/stores/settings/scene';
import { STREETS } from '@/state/stores/settings/streets';
import { GEM, GEM_SIZING } from '@/state/stores/settings/gem';

// computeScenicConfigHash collects the current values of every store whose
// output is baked into buildWorld meshes:
//   - SCENE  : FOG_* keys baked into building shader uniforms
//   - STREETS       : ASPHALT_COLOR + SIDEWALK_* baked into street materials,
//                     LABEL_* baked into label canvas textures + geometry.
//                     (Path-line keys are live Line2 materials, not baked.)
//   - GEM_SIZING    : RADIUS_AS_STREET_FRAC / MIN_RADIUS / HOVER_LIFT_FRAC
//                     baked into gem geometry and position
//   - GEM_FACE_PALETTE: vertex colors baked into gem polyhedron BufferAttribute
//   - GEM_APPEARANCE: EDGE_COLOR + BODY_OPACITY baked into gem materials
//   - GEM_GLOW      : all keys baked into gem sprite materials + scales
// PATH_LINE / HOVER_PATH_LINE are live Line2 meshes, not built by buildWorld.
export function computeScenicConfigHash(): string {
  return JSON.stringify({
    fog: {
      FOG_ENABLED: SCENE.value.FOG_ENABLED,
      FOG_COLOR: SCENE.value.FOG_COLOR,
      FOG_INTENSITY: SCENE.value.FOG_INTENSITY,
      FOG_HEIGHT_FRAC: SCENE.value.FOG_HEIGHT_FRAC,
    },
    streets: {
      ASPHALT_COLOR: STREETS.value.ASPHALT_COLOR,
      SIDEWALK_DEFAULT: STREETS.value.SIDEWALK_DEFAULT,
      SIDEWALK_HOVER: STREETS.value.SIDEWALK_HOVER,
      SIDEWALK_SELECTED: STREETS.value.SIDEWALK_SELECTED,
      LABEL_FILL: STREETS.value.LABEL_FILL,
      LABEL_STROKE: STREETS.value.LABEL_STROKE,
      LABEL_STROKE_WIDTH_FRAC: STREETS.value.LABEL_STROKE_WIDTH_FRAC,
      LABEL_HEIGHT_FRAC: STREETS.value.LABEL_HEIGHT_FRAC,
    },
    gemSizing: GEM_SIZING.value,
    // GEM shape + appearance + face palette + glow (NOT the per-frame
    // animation keys, which don't affect the built scene).
    gem: {
      SIDES: GEM.value.SIDES,
      EDGE_COLOR: GEM.value.EDGE_COLOR,
      BODY_OPACITY: GEM.value.BODY_OPACITY,
      FACE_1: GEM.value.FACE_1,
      FACE_2: GEM.value.FACE_2,
      FACE_3: GEM.value.FACE_3,
      FACE_4: GEM.value.FACE_4,
      FACE_5: GEM.value.FACE_5,
      FACE_6: GEM.value.FACE_6,
      FACE_7: GEM.value.FACE_7,
      FACE_8: GEM.value.FACE_8,
      GLOW_ENABLED: GEM.value.GLOW_ENABLED,
      GLOW_INNER_SCALE: GEM.value.GLOW_INNER_SCALE,
      GLOW_INNER_OPACITY: GEM.value.GLOW_INNER_OPACITY,
      GLOW_OUTER_SCALE: GEM.value.GLOW_OUTER_SCALE,
      GLOW_OUTER_OPACITY: GEM.value.GLOW_OUTER_OPACITY,
      GLOW_ANIMATE_COLORS: GEM.value.GLOW_ANIMATE_COLORS,
      GLOW_CYCLE_PERIOD_SECONDS: GEM.value.GLOW_CYCLE_PERIOD_SECONDS,
    },
  });
}

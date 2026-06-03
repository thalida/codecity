// city/components/buildings/boxEdges.ts — unit-cube edge geometry for the
// building hover/selected outline meshes.
//
// 12 edges of a unit cube as flat [x,y,z, x,y,z, ...] segment endpoints.
// Used by Line2 outlines (rendered as triangle strips so linewidth is
// settable in pixels — regular WebGL lines are locked to 1px). Consumed by
// the hover/selected outline meshes in outline.ts.

export const UNIT_BOX_EDGE_POSITIONS = [
  // Bottom face (y = -0.5) — 4 edges around the base.
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5,
  // Top face (y = 0.5) — 4 edges around the roof.
  -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  // Vertical edges — 4 edges connecting corresponding base + roof corners.
  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
];

// city/components/streets/streets.ts — Street rendering: two stacked pill-shaped slabs
// (sidewalk + asphalt) per directory street. Concentric caps so the
// visible sidewalk strip is uniform around the perimeter, including
// the curved ends.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STREETS } from '@/state/stores/settings/streets';
import { ASPHALT_WIDTH_FRAC } from '@/constants/streets';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { CapStyle, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

// Street segments may carry a transient `joinSide` (stamped by
// layout._markJoinSides) telling us which end of the child street
// merges into its parent at a T-intersection. Used to pick the cap
// style so the joining end is flat.
type StreetWithJoin = Street & { joinSide?: JoinSide };
type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// Stadium-cap tessellation count for the asphalt + sidewalk shapes.
const STADIUM_SEGMENTS = 16;

// Ground-plane materials — all the flat pieces (sidewalk, asphalt,
// paths) sit at the same world Y. `polygonOffset` alone isn't enough
// to kill z-fighting between coplanar meshes at typical camera
// distances, so we also disable depth-write and control their stacking
// via `renderOrder`: the lowest renderOrder draws first, higher orders
// draw on top cleanly regardless of their actual Y coordinate.
//
// Ground planes still `depthTest` so buildings occlude them correctly.
function flatGroundMaterial(
  color: string | number,
  renderOrderLayer: number
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -renderOrderLayer,
    polygonOffsetUnits: -renderOrderLayer,
  });
  mat.userData.renderOrderLayer = renderOrderLayer;
  return mat;
}

// Concentric-cap asphalt geometry for a street. The asphalt is narrower than
// the sidewalk by ASPHALT_WIDTH_FRAC and shorter by exactly the per-side
// sidewalk strip width on each end — that keeps the two cap circles sharing a
// center so the annular sidewalk strip stays uniform thickness around the
// curve at any street length. Lengths floor at 0 so degenerate streets don't
// render a negative-length stadium. Shared by createStreetMesh (geometry) and
// streetLabels (usable-road-length fit).
export function asphaltDims(street: { width: number; length: number }): {
  asphaltWidth: number;
  sidewalkStrip: number;
  asphaltLength: number;
} {
  const asphaltWidth = street.width * ASPHALT_WIDTH_FRAC;
  const sidewalkStrip = (street.width - asphaltWidth) / 2;
  const asphaltLength = Math.max(0, street.length - 2 * sidewalkStrip);
  return { asphaltWidth, sidewalkStrip, asphaltLength };
}

// _buildStadiumGeometry(length, width, orientation, capStyle) -> ShapeGeometry
//
// A pill / stadium / rectangle-with-rounded-ends shape, lying in the XY
// plane (intended to be rotated -π/2 around X to lie flat on world XZ).
// `orientation` picks which 2D axis the long direction runs along.
//
// `capStyle` controls which ends are rounded:
//   'both' — semicircular caps at both ends (the classic pill; used for
//            the root street, which has no parent intersection)
//   'high' — rounded only at the +length end; flat at the −length end
//            (used by non-root children whose joining endpoint is at
//            local low — they merge cleanly into the parent there)
//   'low'  — rounded only at the −length end; flat at the +length end
//
// In all three cases the shape's extent along the long axis is exactly
// `length`, centered at 0, so the caller's positioning math doesn't
// change with cap style.
function _buildStadiumGeometry(
  length: number,
  width: number,
  orientation: StreetAxis,
  capStyle: CapStyle
): THREE.ShapeGeometry {
  capStyle = capStyle || CapStyle.Both;
  // capStyle is specified in WORLD-axis terms (Low = round the world-low
  // end, High = the world-high end). The mesh is rotated -π/2 around X
  // to lie flat: local x maps directly to world X (no flip), but local y
  // maps to world -z (flipped). So for y-orient streets, "world low" is
  // at LOCAL HIGH and vice versa — invert capStyle here so the geometry
  // construction below stays in plain local-axis terms.
  if (orientation === StreetAxis.Y) {
    if (capStyle === CapStyle.Low) capStyle = CapStyle.High;
    else if (capStyle === CapStyle.High) capStyle = CapStyle.Low;
  }
  const r = width / 2;
  const roundLow = capStyle === CapStyle.Both || capStyle === CapStyle.Low;
  const roundHigh = capStyle === CapStyle.Both || capStyle === CapStyle.High;
  // The straight section's long-axis range. When a side is rounded, the
  // straight section ends r before the world edge; when flat, it extends
  // all the way out to the world edge.
  let lo = roundLow ? -length / 2 + r : -length / 2;
  let hi = roundHigh ? length / 2 - r : length / 2;
  if (lo > hi) lo = hi = 0; // degenerate: width > length, collapse to 0

  const shape = new THREE.Shape();
  if (orientation === StreetAxis.X) {
    // Trace counter-clockwise: start at low-bottom corner, run along the
    // bottom edge, round (or flat) the high end, run back along the top,
    // and round (or flat) the low end. Auto-closes back to start.
    shape.moveTo(lo, -r);
    shape.lineTo(hi, -r);
    if (roundHigh) shape.absarc(hi, 0, r, -Math.PI / 2, Math.PI / 2, false);
    else shape.lineTo(hi, r);
    shape.lineTo(lo, r);
    if (roundLow) shape.absarc(lo, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    else shape.lineTo(lo, -r);
  } else {
    shape.moveTo(-r, lo);
    if (roundLow) shape.absarc(0, lo, r, Math.PI, 2 * Math.PI, false);
    else shape.lineTo(r, lo);
    shape.lineTo(r, hi);
    if (roundHigh) shape.absarc(0, hi, r, 0, Math.PI, false);
    else shape.lineTo(-r, hi);
  }
  return new THREE.ShapeGeometry(shape, STADIUM_SEGMENTS);
}

// Cap style: the root has rounded caps both sides; non-root streets are FLAT at
// their joining end (so they merge cleanly into the parent at the T-intersection)
// and rounded only at the open end. Layout stamps each non-root street with
// `joinSide`. The SAME cap style feeds both sidewalk + asphalt so their flat ends
// line up and the visible sidewalk strip stays uniform around the cap.
export function capStyleFor(street: StreetWithJoin): CapStyle {
  if (street.isRoot) return CapStyle.Both;
  if (street.joinSide === JoinSide.High) return CapStyle.Low; // round the low/open end
  return CapStyle.High; // round the high/open end
}

// createSidewalkMesh(street) -> the clickable sidewalk slab (outer pill). Per
// street because it carries userData.street for picking + is tinted individually
// on hover/selection. renderOrder=SIDEWALK draws all sidewalks as the bottom
// ground layer.
export function createSidewalkMesh(street: StreetWithJoin, yBase: number): FlatMesh {
  const streets = STREETS.value;
  const capStyle = capStyleFor(street);
  const sidewalk = new THREE.Mesh(
    _buildStadiumGeometry(street.length, street.width, street.orientation, capStyle),
    flatGroundMaterial(streets.SIDEWALK_DEFAULT, RENDER_ORDERS.SIDEWALK)
  ) as FlatMesh;
  sidewalk.rotation.x = -Math.PI / 2;
  sidewalk.position.set(street.x, yBase, street.y);
  sidewalk.renderOrder = RENDER_ORDERS.SIDEWALK;
  sidewalk.userData.street = street;
  sidewalk.userData.type = NodeKind.Directory;
  return sidewalk;
}

// buildAsphaltGeometry(street) -> the asphalt pill geometry, BAKED into world
// space (rotated flat + translated to the street position). Asphalt is one solid
// color and not pickable, so every street's asphalt merges into a single mesh —
// see the streets component. Concentric with the sidewalk cap (asphaltDims) so
// the sidewalk strip stays a uniform width around the perimeter.
export function buildAsphaltGeometry(street: StreetWithJoin, yBase: number): THREE.BufferGeometry {
  const { asphaltWidth, asphaltLength } = asphaltDims(street);
  const geo = _buildStadiumGeometry(asphaltLength, asphaltWidth, street.orientation, capStyleFor(street));
  geo.rotateX(-Math.PI / 2);
  geo.translate(street.x, yBase, street.y);
  return geo;
}

// createMergedAsphaltMesh(streets) -> ONE mesh holding every street's asphalt.
// Baking all asphalt pills into a single geometry collapses ~8k draw calls (two
// per street) to one — the biggest render-load win at Linux scale, since asphalt
// is a single solid color and never picked. Returns null for an empty layout.
export function createMergedAsphaltMesh(
  streets: StreetWithJoin[],
  yBase: number
): FlatMesh | null {
  if (streets.length === 0) return null;
  const geos = streets.map((s) => buildAsphaltGeometry(s, yBase));
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(
    merged,
    flatGroundMaterial(STREETS.value.ASPHALT_COLOR, RENDER_ORDERS.ASPHALT)
  ) as FlatMesh;
  mesh.renderOrder = RENDER_ORDERS.ASPHALT;
  mesh.name = 'city-asphalt';
  return mesh;
}

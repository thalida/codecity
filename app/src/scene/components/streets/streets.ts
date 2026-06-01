// streets.ts — Street rendering: two stacked pill-shaped slabs
// (sidewalk + asphalt) per directory street. Concentric caps so the
// visible sidewalk strip is uniform around the perimeter, including
// the curved ends.

import * as THREE from 'three';
import { STREETS } from '@/state/settings/components/streets';
import { ASPHALT_WIDTH_FRAC } from '@/constants/streets';
import { RENDER_ORDERS } from '@/scene/renderOrders';
import { CapStyle, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

// Street segments may carry a transient `joinSide` (stamped by
// layout._markJoinSides) telling us which end of the child street
// merges into its parent at a T-intersection. Used to pick the cap
// style so the joining end is flat.
type StreetWithJoin = Street & { joinSide?: JoinSide };

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
export function flatGroundMaterial(
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

// createStreetMesh(street) -> THREE.Group
//
// A street is two stacked flat pill-shaped slabs — sidewalk (outer) and
// asphalt (inner). The asphalt pill is sized and positioned so its cap
// circle is CONCENTRIC with the sidewalk cap circle, which keeps the
// visible sidewalk strip a uniform width all the way around the perimeter
// (including around the curved end caps). The group's userData.street
// points back to the layout street so raycaster hits can recover the
// directory this street represents.
export function createStreetMesh(street: StreetWithJoin, yBase: number): THREE.Group {
  const streets = STREETS.value;
  const group = new THREE.Group();
  const asphaltWidth = street.width * ASPHALT_WIDTH_FRAC;
  // For concentric caps the asphalt must be shorter by exactly the sidewalk
  // strip width (= (width - asphaltWidth) / 2 per side). That makes the two
  // cap circles share a center and the annular sidewalk strip keep constant
  // thickness around the curve — the cap stays correctly rounded at any
  // street length. Floor at 0 so degenerate streets don't try to render
  // a negative-length stadium.
  const sidewalkStrip = (street.width - asphaltWidth) / 2;
  const asphaltLength = Math.max(0, street.length - 2 * sidewalkStrip);

  // Cap style: the root has rounded caps both sides; non-root streets are
  // FLAT at their joining end (so they merge cleanly into the parent at
  // the T-intersection) and rounded only at the open end. Layout stamps
  // each non-root street with `joinSide` after layout.
  // Same capStyle is passed to BOTH sidewalk + asphalt so their flat ends
  // line up and the visible sidewalk strip stays uniform around the cap.
  let capStyle: CapStyle;
  if (street.isRoot) capStyle = CapStyle.Both;
  else if (street.joinSide === JoinSide.High)
    capStyle = CapStyle.Low; // round the low/open end
  else capStyle = CapStyle.High; // round the high/open end

  // Sidewalk — the clickable target for street picking. renderOrder=1
  // means all sidewalks across the city draw first, as a single bottom layer.
  const orders = RENDER_ORDERS;
  const sidewalk = new THREE.Mesh(
    _buildStadiumGeometry(street.length, street.width, street.orientation, capStyle),
    flatGroundMaterial(streets.SIDEWALK_DEFAULT, orders.SIDEWALK)
  );
  sidewalk.rotation.x = -Math.PI / 2;
  sidewalk.position.set(street.x, yBase, street.y);
  sidewalk.renderOrder = orders.SIDEWALK;
  sidewalk.userData.street = street;
  sidewalk.userData.type = NodeKind.Directory;
  group.add(sidewalk);

  // Asphalt — narrower, always draws on top of every sidewalk.
  const asphalt = new THREE.Mesh(
    _buildStadiumGeometry(asphaltLength, asphaltWidth, street.orientation, capStyle),
    flatGroundMaterial(streets.ASPHALT_COLOR, orders.ASPHALT)
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(street.x, yBase, street.y);
  asphalt.renderOrder = orders.ASPHALT;
  group.add(asphalt);

  group.userData.street = street;
  group.userData.sidewalk = sidewalk; // exposed so callers can pick on it
  group.userData.asphalt = asphalt; // exposed for live theme recolor
  group.userData.type = NodeKind.Directory;
  return group;
}

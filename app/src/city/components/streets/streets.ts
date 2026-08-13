// city/components/streets/streets.ts — Street rendering: two stacked pill-shaped slabs
// (sidewalk + asphalt) per directory street. Concentric caps so the
// visible sidewalk strip is uniform around the perimeter, including
// the curved ends.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STREETS } from '@/state/stores/settings/streets';
import { RUINS } from '@/state/stores/settings/ruins';
import { ASPHALT_WIDTH_FRAC } from '@/constants/streets';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
import { CapStyle, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

// `joinSide` says which end of a child street merges into its parent, so that
// end can be capped flat.
type StreetWithJoin = Street & { joinSide?: JoinSide };
type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// Stadium-cap tessellation count for the asphalt + sidewalk shapes.
const STADIUM_SEGMENTS = 16;

// Per-vertex alpha, and per-vertex ruin tint when Timeline passes the uniforms.
// Both are inert in live mode, which renders byte-identically without them.
function injectStreetOpacity(
  mat: THREE.MeshBasicMaterial,
  tintUniforms?: { ruin: { value: THREE.Color } }
): void {
  // Distinguishes this variant in three's program cache so a plain MeshBasicMaterial
  // with the same param signature can't collide and skip the onBeforeCompile injection.
  mat.customProgramCacheKey = () => (tintUniforms ? 'street-opacity-tint' : 'street-opacity');
  mat.onBeforeCompile = (shader) => {
    if (tintUniforms) {
      shader.uniforms.uRuinColor = tintUniforms.ruin;
    }
    const tintDecl = tintUniforms ? '\nattribute float aRuin;\nvarying float vRuin;' : '';
    const tintAssign = tintUniforms ? '\nvRuin = aRuin;' : '';
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute float aOpacity;\nvarying float vOpacity;${tintDecl}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvOpacity = aOpacity;${tintAssign}`
      );
    const fragDecl = tintUniforms ? '\nvarying float vRuin;\nuniform vec3 uRuinColor;' : '';
    const fragMix = tintUniforms
      ? 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uRuinColor, step(0.5, vRuin));\n'
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vOpacity;${fragDecl}`)
      .replace(
        '#include <dithering_fragment>',
        `${fragMix}#include <dithering_fragment>\ngl_FragColor.a *= vOpacity;`
      );
  };
}

// Per-vertex opacity attribute (all 1) for a merged street geometry.
function seedOpacityAttribute(geo: THREE.BufferGeometry): void {
  const opacity = new Float32Array(geo.attributes.position.count).fill(1);
  geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1));
}

// Every flat piece sits at one Y, and polygonOffset alone doesn't settle
// coplanar z-fighting, so they stack by renderOrder with depth-write off.
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

// Shortened by exactly the sidewalk strip at each end, so both cap circles share
// a centre and the sidewalk stays an even thickness around the curve.
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

// A pill in the XY plane, laid flat on XZ. Whichever ends `capStyle` rounds, the
// extent stays exactly `length` centred at 0, so the caller's maths holds.
function _buildStadiumGeometry(
  length: number,
  width: number,
  orientation: StreetAxis,
  capStyle: CapStyle
): THREE.ShapeGeometry {
  capStyle = capStyle || CapStyle.Both;
  // capStyle is world-axis, and laying the mesh flat flips local y to world -z,
  // so a y-oriented street inverts it and the rest can stay local.
  if (orientation === StreetAxis.Y) {
    if (capStyle === CapStyle.Low) capStyle = CapStyle.High;
    else if (capStyle === CapStyle.High) capStyle = CapStyle.Low;
  }
  const r = width / 2;
  const roundLow = capStyle === CapStyle.Both || capStyle === CapStyle.Low;
  const roundHigh = capStyle === CapStyle.Both || capStyle === CapStyle.High;
  // A rounded end stops r short of the edge; a flat one runs to it.
  let lo = roundLow ? -length / 2 + r : -length / 2;
  let hi = roundHigh ? length / 2 - r : length / 2;
  if (lo > hi) lo = hi = 0; // degenerate: width > length, collapse to 0

  const shape = new THREE.Shape();
  if (orientation === StreetAxis.X) {
    // Traced counter-clockwise from the low-bottom corner; auto-closes.
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

// Flat where a street joins its parent, rounded at the open end. Sidewalk and
// asphalt take the same style, or their flat ends wouldn't line up.
function capStyleFor(street: StreetWithJoin): CapStyle {
  if (street.isRoot) return CapStyle.Both;
  if (street.joinSide === JoinSide.High) return CapStyle.Low; // round the low/open end
  return CapStyle.High; // round the high/open end
}

// A street's span in the merged mesh, for tinting and for picking. Stored in
// build order, so faceStarts ascends and the picker can binary-search it.
export interface SidewalkRange {
  street: StreetWithJoin;
  path: string | null;
  vStart: number;
  vCount: number;
  faceStart: number;
}

// Per-street vertex span within the merged asphalt mesh, for fading a street's asphalt in lockstep with its sidewalk.
export interface AsphaltRange {
  street: StreetWithJoin;
  vStart: number;
  vCount: number;
}

// Every sidewalk slab in one mesh, ~8k draw calls collapsed to 1. Unlike asphalt
// it keeps per-vertex colour and a face→street map, so it stays pickable.
export function createMergedSidewalkMesh(
  streets: StreetWithJoin[],
  yBase: number
): { mesh: FlatMesh; ranges: SidewalkRange[] } | null {
  if (streets.length === 0) return null;
  const geos: THREE.BufferGeometry[] = [];
  const ranges: SidewalkRange[] = [];
  let vAcc = 0;
  let fAcc = 0;
  for (const s of streets) {
    const geo = _buildStadiumGeometry(s.length, s.width, s.orientation, capStyleFor(s));
    geo.rotateX(-Math.PI / 2);
    geo.translate(s.x, yBase, s.y);
    const vCount = geo.attributes.position.count;
    const fCount = geo.index ? geo.index.count / 3 : vCount / 3;
    ranges.push({ street: s, path: s.dir?.path ?? null, vStart: vAcc, vCount, faceStart: fAcc });
    vAcc += vCount;
    fAcc += fCount;
    geos.push(geo);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();

  // The material's base colour stays white: vertex colours multiply into it, so
  // anything else would tint the whole run.
  const def = new THREE.Color(STREETS.value.SIDEWALK_DEFAULT);
  const colors = new Float32Array(vAcc * 3);
  for (let i = 0; i < vAcc; i++) {
    colors[i * 3] = def.r;
    colors[i * 3 + 1] = def.g;
    colors[i * 3 + 2] = def.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  seedOpacityAttribute(merged);
  // Written per-street by the scrub controller, and all 0 in live mode, where
  // the hover and select colours show through unchanged.
  merged.setAttribute('aRuin', new THREE.BufferAttribute(new Float32Array(vAcc), 1));

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -RENDER_ORDERS.SIDEWALK,
    polygonOffsetUnits: -RENDER_ORDERS.SIDEWALK,
  });
  // Sidewalk border tint uses SIDEWALK_COLOR (distinct from the asphalt's road color).
  const ruinUniform = { value: new THREE.Color() };
  setColorFromHex(ruinUniform.value, RUINS.value.SIDEWALK_COLOR);
  injectStreetOpacity(mat, { ruin: ruinUniform });
  mat.userData.uRuinColor = ruinUniform;
  const mesh = new THREE.Mesh(merged, mat) as FlatMesh;
  mesh.renderOrder = RENDER_ORDERS.SIDEWALK;
  mesh.name = 'city-sidewalk';
  mesh.userData.type = NodeKind.Directory;
  mesh.userData.pickFaceStarts = ranges.map((r) => r.faceStart);
  mesh.userData.pickStreets = ranges.map((r) => r.street);
  return { mesh, ranges };
}

// A raycast faceIndex back to its street: the largest faceStart at or below it,
// binary-searched, since the ranges are contiguous and ascending.
export function sidewalkStreetForFace(
  mesh: THREE.Object3D,
  faceIndex: number
): StreetWithJoin | null {
  const starts = mesh.userData.pickFaceStarts as number[] | undefined;
  const streets = mesh.userData.pickStreets as StreetWithJoin[] | undefined;
  if (!starts || !streets) return null;
  let lo = 0;
  let hi = starts.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= faceIndex) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx >= 0 ? (streets[idx] ?? null) : null;
}

// Baked into world space. Concentric with the sidewalk cap, so the strip around
// it keeps a uniform width.
function buildAsphaltGeometry(street: StreetWithJoin, yBase: number): THREE.BufferGeometry {
  const { asphaltWidth, asphaltLength } = asphaltDims(street);
  const geo = _buildStadiumGeometry(
    asphaltLength,
    asphaltWidth,
    street.orientation,
    capStyleFor(street)
  );
  geo.rotateX(-Math.PI / 2);
  geo.translate(street.x, yBase, street.y);
  return geo;
}

// Every street's asphalt in one mesh: one colour and never picked, so ~8k draw
// calls collapse to one. The per-street ranges are what Timeline fades.
export function createMergedAsphaltMesh(
  streets: StreetWithJoin[],
  yBase: number
): { mesh: FlatMesh; ranges: AsphaltRange[] } | null {
  if (streets.length === 0) return null;
  const geos: THREE.BufferGeometry[] = [];
  const ranges: AsphaltRange[] = [];
  let vAcc = 0;
  for (const s of streets) {
    const geo = buildAsphaltGeometry(s, yBase);
    const vCount = geo.attributes.position.count;
    ranges.push({ street: s, vStart: vAcc, vCount });
    vAcc += vCount;
    geos.push(geo);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  seedOpacityAttribute(merged);
  // Written per-street by the scrub controller; all 0 in live mode.
  merged.setAttribute('aRuin', new THREE.BufferAttribute(new Float32Array(vAcc), 1));
  const mat = flatGroundMaterial(STREETS.value.ASPHALT_COLOR, RENDER_ORDERS.ASPHALT);
  // Shared with the shader (onBeforeCompile) AND the component's tint-color
  // effects, which keep .value current on a Save. Stored on userData for them.
  const ruinUniform = { value: new THREE.Color() };
  setColorFromHex(ruinUniform.value, RUINS.value.ROAD_COLOR);
  injectStreetOpacity(mat, { ruin: ruinUniform });
  mat.userData.uRuinColor = ruinUniform;
  const mesh = new THREE.Mesh(merged, mat) as FlatMesh;
  mesh.renderOrder = RENDER_ORDERS.ASPHALT;
  mesh.name = 'city-asphalt';
  return { mesh, ranges };
}

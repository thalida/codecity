// streetLabels.ts — Flat text painted on the road, aligned with the
// street's long axis (like labels on a map). Longer streets repeat the
// label so you always have one nearby. Each label is a plane lifted a
// tiny amount above the asphalt so it doesn't z-fight with the road,
// and it participates in normal depth testing so buildings occlude it
// correctly — no clipping through them.
//
// Fit policy: labels would otherwise size purely from street width and
// the text's aspect ratio, so a long directory name on a narrow/short
// street overflows past the road ends. We shrink uniformly to fit, and
// once we'd have to go below LABEL_MIN_SCALE we truncate the text with an
// ellipsis instead — readability over geometric correctness.
//
// Each returned Group wraps one label plane and exposes its orientation
// via userData so the render loop can flip it 180° around scene-Y when
// the camera orbits to the "upside-down" side.

import * as THREE from 'three';
import { STREETS } from '@/state/settings/components/streets';
import { ASPHALT_WIDTH_FRAC, LABEL_FONT_FAMILY, LABEL_FONT_WEIGHT, LABEL_ELEVATION } from '@/constants/streets';
import { RENDER_ORDERS } from '@/scene/renderOrders';
import { NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

// Hardcoded label constants — these were previously in LABEL_TYPOGRAPHY but
// have no visible effect at normal viewing distances, so they are baked in
// here rather than exposed as UI controls.
const LABEL_FONT_SIZE_PX = 192; // source canvas font size; only affects texture sharpness, not world-space label size
const LABEL_CANVAS_PADDING_FRAC = 0.25; // padding around glyphs as a fraction of LABEL_FONT_SIZE_PX
const LABEL_MIN_SCALE = 0.5; // floor for fit-shrink before truncation with ellipsis
const LABEL_SPACING_MULT = 8.0; // repeat spacing = label width × this
const LABEL_SPACING_FLOOR = 256; // …or this floor (world units), whichever is larger

// Label canvas drawing internals — must stay 'center'/'middle' for the
// centered draw math, and label texture filtering anisotropy.
const LABEL_TEXT_ALIGN = 'center';
const LABEL_TEXT_BASELINE = 'middle';
const LABEL_ANISOTROPY = 16;
const LABEL_ELLIPSIS = '…';

function _buildLabelTexture(
  text: string,
  maxAspect?: number
): { texture: THREE.CanvasTexture; aspect: number; text: string } {
  // High source resolution so close-zoom doesn't reveal bilinear blur.
  // The world-space plane size is unchanged — we're just packing more
  // texels into the same footprint.
  const streets = STREETS.value;
  const fontSpec = `${LABEL_FONT_WEIGHT} ${LABEL_FONT_SIZE_PX}px ${LABEL_FONT_FAMILY}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = fontSpec;
  const paddingPx = Math.round(LABEL_FONT_SIZE_PX * LABEL_CANVAS_PADDING_FRAC);
  const strokeWidthPx = Math.round(LABEL_FONT_SIZE_PX * streets.LABEL_STROKE_WIDTH_FRAC);
  const canvasH = LABEL_FONT_SIZE_PX + paddingPx * 2;

  let renderText = text;
  if (maxAspect !== undefined) {
    const maxCanvasW = maxAspect * canvasH;
    const naturalCanvasW = Math.ceil(measure.measureText(text).width) + paddingPx * 2;
    if (naturalCanvasW > maxCanvasW) {
      renderText = _truncateToFit(text, maxCanvasW - paddingPx * 2, measure);
    }
  }

  const textW = Math.ceil(measure.measureText(renderText).width);
  const canvas = document.createElement('canvas');
  canvas.width = textW + paddingPx * 2;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontSpec;
  ctx.textAlign = LABEL_TEXT_ALIGN as CanvasTextAlign;
  ctx.textBaseline = LABEL_TEXT_BASELINE as CanvasTextBaseline;

  ctx.lineWidth = strokeWidthPx;
  ctx.strokeStyle = streets.LABEL_STROKE;
  ctx.strokeText(renderText, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = streets.LABEL_FILL;
  ctx.fillText(renderText, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = LABEL_ANISOTROPY;
  return { texture: tex, aspect: canvas.width / canvas.height, text: renderText };
}

// Binary-search the longest prefix of `text` whose canvas-measured width,
// plus a trailing ellipsis, fits within `maxTextWidthPx`. Returns "…" if
// even a single character would overflow.
function _truncateToFit(
  text: string,
  maxTextWidthPx: number,
  measure: CanvasRenderingContext2D
): string {
  if (maxTextWidthPx <= 0) return LABEL_ELLIPSIS;
  if (measure.measureText(LABEL_ELLIPSIS).width > maxTextWidthPx) return LABEL_ELLIPSIS;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + LABEL_ELLIPSIS;
    if (measure.measureText(candidate).width <= maxTextWidthPx) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + LABEL_ELLIPSIS;
}

export function createStreetLabels(street: Street): THREE.Group[] {
  const text = street.label || '';
  if (!text) return [];

  const streets = STREETS.value;
  const orders = RENDER_ORDERS;

  // Usable road length: the rectangular label sits along the flat middle of
  // the asphalt pill, between the two rounded caps. Asphalt length is
  // shorter than the street length by the two sidewalk strips (see
  // streets.ts for the concentric-cap math); we further subtract the
  // asphalt cap diameter so the label's corners don't poke out where the
  // pill rounds off.
  const asphaltWidth = street.width * ASPHALT_WIDTH_FRAC;
  const sidewalkStrip = (street.width - asphaltWidth) / 2;
  const asphaltLength = Math.max(0, street.length - 2 * sidewalkStrip);
  const usableLength = Math.max(0, asphaltLength - asphaltWidth);
  if (usableLength <= 0) return [];

  // Natural sizing: height scales with street width, width follows from the
  // text's aspect ratio. Then fit to usableLength: shrink uniformly down to
  // LABEL_MIN_SCALE; below that, truncate with an ellipsis instead.
  const naturalHeight = street.width * streets.LABEL_HEIGHT_FRAC;
  let info = _buildLabelTexture(text);
  let worldH = naturalHeight;
  let worldW = worldH * info.aspect;

  if (worldW > usableLength) {
    const scaleToFit = usableLength / worldW;
    const minScale = Math.max(0, Math.min(1, LABEL_MIN_SCALE));
    if (scaleToFit >= minScale) {
      worldH = naturalHeight * scaleToFit;
      worldW = usableLength;
    } else {
      worldH = naturalHeight * minScale;
      // At this fixed worldH, the texture aspect must satisfy
      //   aspect ≤ usableLength / worldH
      // so the rebuilt canvas (with truncated text) fits exactly.
      const maxAspect = usableLength / worldH;
      info.texture.dispose();
      info = _buildLabelTexture(text, maxAspect);
      worldW = worldH * info.aspect;
    }
  }

  // Repetition: spacing scales with the label's own rendered width so long
  // names ("codecity") don't pile up on wide streets while short names
  // ("src") still repeat often enough to always have one near the viewport.
  // A minimum floor keeps tiny labels from repeating every few units.
  const spacing = Math.max(worldW * LABEL_SPACING_MULT, LABEL_SPACING_FLOOR);
  const count = Math.max(1, Math.floor(street.length / spacing));

  const labels: THREE.Group[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    const offset = (t - 0.5) * street.length;
    let sx = street.x,
      sz = street.y;
    if (street.orientation === StreetAxis.X) sx += offset;
    else sz += offset;

    const mat = new THREE.MeshBasicMaterial({
      map: info.texture,
      transparent: true,
      // Don't write depth — otherwise the plane's transparent canvas pixels
      // z-block the neon path running underneath, leaving a visible
      // bbox-shaped hole. With depthWrite off, opaque glyph pixels still
      // alpha-blend over the path, but letter loops (O, D, P) reveal it.
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
    plane.rotation.x = -Math.PI / 2; // lay flat
    // Render AFTER the neon path line so the label composites on top.
    plane.renderOrder = orders.STREET_LABEL;

    // Wrap in a group so we can apply a single rotation.y for camera-follow
    // flipping without fighting the Euler order of the flattened plane.
    const group = new THREE.Group();
    group.add(plane);
    // Lift a tiny amount off the asphalt to avoid coplanar z-fighting, while
    // staying well below building tops so buildings still occlude the label.
    group.position.set(sx, LABEL_ELEVATION, sz);
    // Base rotation per orientation. For y-streets the label's reading
    // direction needs to run along scene-Z, so rotate the group 90°.
    group.userData.baseRotY = street.orientation === StreetAxis.Y ? -Math.PI / 2 : 0;
    group.rotation.y = group.userData.baseRotY;
    group.userData.street = street;
    group.userData.type = NodeKind.Label;
    // Stashed for live applyTheme updates: ELEVATION (group.position.y),
    // and HEIGHT_FRAC (plane.scale recomputed from streetWidth × frac).
    group.userData.streetWidth = street.width;
    group.userData.textureAspect = info.aspect;
    group.userData.origHeightFrac = streets.LABEL_HEIGHT_FRAC;
    labels.push(group);
  }
  return labels;
}

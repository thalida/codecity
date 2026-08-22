// city/components/streets/streetLabels.ts — road-name text painted flat along a
// street's long axis, repeated so one is always nearby. Sizing prefers
// readability over geometry: shrink to fit, and past LABEL_MIN_SCALE truncate
// with an ellipsis rather than shrink further.

import * as THREE from 'three';
import type { StreetsConfig } from '@/state/settings/fields/streets';
import { LABEL_FONT_FAMILY, LABEL_FONT_WEIGHT, LABEL_ELEVATION } from '@/city/constants/streets';
import { asphaltDims } from './streets';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

// Hardcoded label constants — these have no visible effect at normal viewing
// distances, so they are baked in here rather than exposed as UI controls.
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
  streets: StreetsConfig,
  maxAspect?: number
): { texture: THREE.CanvasTexture; aspect: number; text: string } {
  // High source resolution so close-zoom doesn't reveal bilinear blur; the
  // world-space plane size is unchanged.
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

// Longest prefix that still fits once the ellipsis is added; "…" alone when
// even one character overflows.
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

export function createStreetLabels(street: Street, streets: StreetsConfig): THREE.Group[] {
  const text = street.label || '';
  if (!text) return [];

  const orders = RENDER_ORDERS;

  // Subtract the cap diameter too: the label is rectangular and would poke its
  // corners out where the asphalt pill rounds off.
  const { asphaltWidth, asphaltLength } = asphaltDims(street);
  const usableLength = Math.max(0, asphaltLength - asphaltWidth);
  if (usableLength <= 0) return [];

  // Height scales with street width and width follows the text's aspect, then
  // the whole thing is fit to usableLength.
  const naturalHeight = street.width * streets.LABEL_HEIGHT_FRAC;
  let info = _buildLabelTexture(text, streets);
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
      // worldH is pinned now, so the rebuilt canvas has to come in at or under
      // this aspect to fit.
      const maxAspect = usableLength / worldH;
      info.texture.dispose();
      info = _buildLabelTexture(text, streets, maxAspect);
      worldW = worldH * info.aspect;
    }
  }

  // Spacing scales with rendered width so long names don't pile up, with a
  // floor so short ones don't repeat every few units.
  const spacing = Math.max(worldW * LABEL_SPACING_MULT, LABEL_SPACING_FLOOR);
  const count = Math.max(1, Math.floor(street.length / spacing));

  // Every repeat of a street is the same quad showing the same texture, so one
  // geometry and one material serve them all. The first group owns the trio.
  const sharedGeometry = new THREE.PlaneGeometry(worldW, worldH);
  const sharedMaterial = new THREE.MeshBasicMaterial({
    map: info.texture,
    transparent: true,
    // Writing depth would z-block the neon path underneath, punching a
    // bbox-shaped hole around the text.
    depthWrite: false,
  });

  const labels: THREE.Group[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    const offset = (t - 0.5) * street.length;
    let sx = street.x,
      sz = street.y;
    if (street.orientation === StreetAxis.X) sx += offset;
    else sz += offset;

    const plane = new THREE.Mesh(sharedGeometry, sharedMaterial);
    plane.userData.sharedGeometry = true;
    plane.userData.sharedMaterial = true;
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
    // Stashed for live theme updates: ELEVATION (group.position.y),
    // and HEIGHT_FRAC (plane.scale recomputed from streetWidth × frac).
    group.userData.streetWidth = street.width;
    group.userData.textureAspect = info.aspect;
    group.userData.origHeightFrac = streets.LABEL_HEIGHT_FRAC;
    // Natural, not the shrunk worldH: the visibility LOD tracks street size, so
    // a text-shrunk label shouldn't cull earlier than its neighbours.
    group.userData.worldH = naturalHeight;
    // Both transforms are final until a camera flip rotates the group or a
    // STREETS Save rescales the plane; those two sites updateMatrix by hand.
    plane.matrixAutoUpdate = false;
    plane.updateMatrix();
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    labels.push(group);
  }
  // Nothing else frees these: the planes opt out so they can't free a sibling's
  // resources, so the street's teardown reaches them through here.
  labels[0].userData.labelResources = { geometry: sharedGeometry, material: sharedMaterial };
  return labels;
}

/** Free the geometry, material and texture one street's labels share. */
export function disposeStreetLabelResources(labels: readonly THREE.Group[]): void {
  const owned = labels[0]?.userData.labelResources as
    { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial } | undefined;
  if (!owned) return;
  owned.geometry.dispose();
  owned.material.map?.dispose();
  owned.material.dispose();
  delete labels[0].userData.labelResources;
}

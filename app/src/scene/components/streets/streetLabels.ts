// streetLabels.ts — Flat text painted on the road, aligned with the
// street's long axis (like labels on a map). Longer streets repeat the
// label so you always have one nearby. Each label is a plane lifted a
// tiny amount above the asphalt so it doesn't z-fight with the road,
// and it participates in normal depth testing so buildings occlude it
// correctly — no clipping through them.
//
// Each returned Group wraps one label plane and exposes its orientation
// via userData so the render loop can flip it 180° around scene-Y when
// the camera orbits to the "upside-down" side.

import * as THREE from 'three';
import { LABEL_TYPOGRAPHY } from '@/config/components/streets.js';
import { RENDER_ORDERS } from '@/constants';
import { NodeKind, StreetAxis } from '@/types';
import type { Street } from '@/types';

// Label canvas drawing internals — must stay 'center'/'middle' for the
// centered draw math, and label texture filtering anisotropy.
const LABEL_TEXT_ALIGN = 'center';
const LABEL_TEXT_BASELINE = 'middle';
const LABEL_ANISOTROPY = 16;

function _buildLabelTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  // High source resolution so close-zoom doesn't reveal bilinear blur.
  // The world-space plane size is unchanged — we're just packing more
  // texels into the same footprint.
  const label = LABEL_TYPOGRAPHY.get();
  const fontSpec = `${label.FONT_WEIGHT} ${label.FONT_SIZE_PX}px ${label.FONT_FAMILY}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = fontSpec;
  const textW = Math.ceil(measure.measureText(text).width);
  const paddingPx = Math.round(label.FONT_SIZE_PX * label.CANVAS_PADDING_FRAC);
  const strokeWidthPx = Math.round(label.FONT_SIZE_PX * label.STROKE_WIDTH_FRAC);
  const canvas = document.createElement('canvas');
  canvas.width = textW + paddingPx * 2;
  canvas.height = label.FONT_SIZE_PX + paddingPx * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontSpec;
  ctx.textAlign = LABEL_TEXT_ALIGN as CanvasTextAlign;
  ctx.textBaseline = LABEL_TEXT_BASELINE as CanvasTextBaseline;

  ctx.lineWidth = strokeWidthPx;
  ctx.strokeStyle = label.STROKE;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = label.FILL;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = LABEL_ANISOTROPY;
  return { texture: tex, aspect: canvas.width / canvas.height };
}

export function createStreetLabels(street: Street): THREE.Group[] {
  const text = street.label || '';
  if (!text) return [];

  const label = LABEL_TYPOGRAPHY.get();
  const orders = RENDER_ORDERS;
  const info = _buildLabelTexture(text);

  // Label sizing scales with street width — narrow alleys get small text,
  // wide boulevards get large text — so the label always fits its asphalt
  // and reads at a consistent proportion of the street it's labeling.
  const worldH = street.width * label.HEIGHT_FRAC;
  const worldW = worldH * info.aspect;

  // Repetition: spacing scales with the label's own rendered width so long
  // names ("codecity") don't pile up on wide streets while short names
  // ("src") still repeat often enough to always have one near the viewport.
  // A minimum floor keeps tiny labels from repeating every few units.
  const spacing = Math.max(worldW * label.SPACING_MULT, label.SPACING_FLOOR);
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
    group.position.set(sx, label.ELEVATION, sz);
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
    group.userData.origHeightFrac = label.HEIGHT_FRAC;
    labels.push(group);
  }
  return labels;
}

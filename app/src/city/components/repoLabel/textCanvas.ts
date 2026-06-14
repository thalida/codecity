// city/components/repoLabel/textCanvas.ts — Repo-name text rendered
// into a CanvasTexture for the floating repo-name label.
//
// One canvas per RepoLabel instance, redrawn in place on rename so the
// CanvasTexture identity (and therefore the active ShaderMaterial)
// never changes across name updates.
//
// Output is monochrome (white core + white outer glow). The style
// shaders (ring/hologram/concentric) apply their own neon tints in the
// fragment stage; the canvas just supplies an alpha mask.

import * as THREE from 'three';

const CANVAS_HEIGHT = 128;
const FONT_PX = 80;
// Floor for the auto-shrink path. Below this the label becomes unreadable;
// pathologically long names that would need a smaller font are kept at
// MIN_FONT_PX and accept some letter overlap rather than vanishing.
const MIN_FONT_PX = 24;
// Padding on each side so the outer glow doesn't clip at the canvas edge.
const SIDE_PAD = 32;
// Canvas-width cap. Bounds the panel's world-space width (panel.scale.x =
// FONT_SIZE × canvas.width / canvas.height) so the label doesn't grow wider
// than the city for a long name. When the text wouldn't fit at FONT_PX
// inside (MAX_WIDTH − 2·SIDE_PAD), the font is auto-shrunk to fit; the
// canvas itself never exceeds MAX_WIDTH.
const MAX_WIDTH = 1024;
const FONT_FAMILY = "'Orbitron', 'Eurostile', system-ui, sans-serif";

export interface RepoNameTexture {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  /** canvas.width / canvas.height — used to size geometries that take an aspect. */
  aspect: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Choose the font size + canvas width for a given name.
 *
 * Picks the largest font size ≤ FONT_PX such that the text fits within
 * (MAX_WIDTH − 2·SIDE_PAD). For typical names this is FONT_PX unchanged;
 * only names that would overflow at full size trigger the shrink path.
 * The returned canvasWidth is the smallest pow-of-2 ≥ 256 that fits the
 * (possibly shrunken) text plus padding, capped at MAX_WIDTH.
 *
 * Exported for test access — paint() needs the same fontPx that
 * measureForName picked so the text actually fits the canvas it sized.
 */
export function measureForName(name: string): { fontPx: number; canvasWidth: number } {
  const measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return { fontPx: FONT_PX, canvasWidth: MAX_WIDTH };

  const safeName = name || ' ';
  const maxTextWidth = MAX_WIDTH - SIDE_PAD * 2;

  ctx.font = `700 ${FONT_PX}px ${FONT_FAMILY}`;
  let textWidth = ctx.measureText(safeName).width;
  let fontPx = FONT_PX;
  if (textWidth > maxTextWidth) {
    // Shrink proportionally to the overflow ratio. measureText is roughly
    // linear in font size, but subpixel hinting can leave the result a
    // fraction of a pixel over; nudge fontPx down until it actually fits
    // (≤2 iterations in practice, and MIN_FONT_PX caps the worst case).
    fontPx = Math.max(MIN_FONT_PX, Math.floor((FONT_PX * maxTextWidth) / textWidth));
    ctx.font = `700 ${fontPx}px ${FONT_FAMILY}`;
    textWidth = ctx.measureText(safeName).width;
    while (fontPx > MIN_FONT_PX && textWidth > maxTextWidth) {
      fontPx -= 1;
      ctx.font = `700 ${fontPx}px ${FONT_FAMILY}`;
      textWidth = ctx.measureText(safeName).width;
    }
  }
  const desired = Math.ceil(textWidth) + SIDE_PAD * 2;
  const canvasWidth = Math.min(MAX_WIDTH, Math.max(256, nextPow2(desired)));
  return { fontPx, canvasWidth };
}

function paint(canvas: HTMLCanvasElement, name: string, fontPx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Center the text horizontally and vertically.
  ctx.font = `700 ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Outer glow pass — white fill with a wide soft shadow.
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 24;
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);

  // Inner core pass — re-paint without shadow so the letter centers
  // stay opaque (shadows only paint where the glyph alpha is non-zero,
  // so a second pass crisps up the core).
  ctx.shadowBlur = 0;
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
}

export function createRepoNameTexture(name: string): RepoNameTexture {
  const { fontPx, canvasWidth } = measureForName(name);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = CANVAS_HEIGHT;
  paint(canvas, name, fontPx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return { canvas, texture, aspect: canvas.width / canvas.height };
}

export function redrawRepoName(out: RepoNameTexture, name: string): void {
  const { fontPx, canvasWidth } = measureForName(name);
  if (canvasWidth !== out.canvas.width) {
    // Three.js cannot resize a Texture's GPU allocation once texStorage2D
    // has run — Texture.js says "After the initial use of a texture, its
    // dimensions [...] cannot be changed. Instead, call Texture#dispose
    // [...] and instantiate a new one." Mutating the canvas in place and
    // flagging needsUpdate uploads via texSubImage2D into the OLD-sized
    // GPU allocation, which either clips the new text or leaves stale
    // pixels visible. Dispose + rebuild so the next render allocates fresh
    // storage at the new dimensions. Callers must re-read out.texture and
    // update any uniforms that previously referenced the old one.
    out.texture.dispose();
    const fresh = createRepoNameTexture(name);
    out.canvas = fresh.canvas;
    out.texture = fresh.texture;
    out.aspect = fresh.aspect;
    return;
  }
  // Same width — texSubImage2D handles the upload without re-allocation.
  paint(out.canvas, name, fontPx);
  out.texture.needsUpdate = true;
}

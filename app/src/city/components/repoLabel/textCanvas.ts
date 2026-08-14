// city/components/repoLabel/textCanvas.ts — the repo name as a CanvasTexture.
// One canvas per label, redrawn in place on rename so the texture identity (and
// the material holding it) survives. Monochrome on purpose: the style shaders
// tint it, so this only supplies an alpha mask.

import * as THREE from 'three';

const CANVAS_HEIGHT = 128;
const FONT_PX = 80;
// Auto-shrink floor: a name long enough to need less takes letter overlap
// rather than vanishing.
const MIN_FONT_PX = 24;
// Padding on each side so the outer glow doesn't clip at the canvas edge.
const SIDE_PAD = 32;
// Width cap: the panel's world width scales with canvas.width/height, so
// without it a long name grows wider than the city. Long text shrinks instead.
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

/** The largest font that fits, and the smallest pow-of-2 canvas holding it.
 *  Exported: paint() must use this fontPx or the text overflows its canvas. */
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
    // measureText is roughly linear in font size, but subpixel hinting can
    // leave it a fraction over: nudge down until it really fits.
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

/** The aspect createRepoNameTexture would produce, without building one: the
 *  framing needs it before any mesh exists, and the same number after. */
export function aspectForName(name: string): number {
  return measureForName(name).canvasWidth / CANVAS_HEIGHT;
}

function paint(canvas: HTMLCanvasElement, name: string, fontPx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.font = `700 ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Outer glow pass — white fill with a wide soft shadow.
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 24;
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);

  // Re-paint without the shadow: it only lands where glyph alpha is non-zero,
  // so a second pass crisps the core.
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
    // A Texture's allocation can't be resized after first use: an in-place
    // redraw clips or leaves stale pixels. Callers must re-read out.texture.
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

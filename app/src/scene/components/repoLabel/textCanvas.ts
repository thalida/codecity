// scene/components/repoLabel/textCanvas.ts — Repo-name text rendered
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
// Padding on each side so the outer glow doesn't clip at the canvas edge.
const SIDE_PAD = 32;
// Max canvas width — above this, sampling cost is noticeable. Long
// repo names beyond this cap are clipped.
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

function measureWidth(name: string): number {
  const measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return MAX_WIDTH;
  ctx.font = `700 ${FONT_PX}px ${FONT_FAMILY}`;
  const m = ctx.measureText(name || ' ');
  const desired = Math.ceil(m.width) + SIDE_PAD * 2;
  return Math.min(MAX_WIDTH, Math.max(256, nextPow2(desired)));
}

function paint(canvas: HTMLCanvasElement, name: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Center the text horizontally and vertically.
  ctx.font = `700 ${FONT_PX}px ${FONT_FAMILY}`;
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
  const canvas = document.createElement('canvas');
  canvas.width = measureWidth(name);
  canvas.height = CANVAS_HEIGHT;
  paint(canvas, name);

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
  const newWidth = measureWidth(name);
  if (newWidth !== out.canvas.width) {
    out.canvas.width = newWidth;
  }
  paint(out.canvas, name);
  out.aspect = out.canvas.width / out.canvas.height;
  out.texture.needsUpdate = true;
}

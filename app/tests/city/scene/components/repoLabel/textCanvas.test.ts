import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createRepoNameTexture,
  measureForName,
  redrawRepoName,
} from '@/city/scene/components/repoLabel/textCanvas';

describe('repoLabel textCanvas', () => {
  it('createRepoNameTexture returns a CanvasTexture sized for the name', () => {
    const out = createRepoNameTexture('codecity');
    expect(out.texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(out.canvas).toBeInstanceOf(HTMLCanvasElement);
    // Width is power-of-two and >= 256.
    expect(out.canvas.width).toBeGreaterThanOrEqual(256);
    expect(out.canvas.width & (out.canvas.width - 1)).toBe(0);
    // Height is the fixed 128 px target.
    expect(out.canvas.height).toBe(128);
  });

  it('aspect tracks canvas dimensions', () => {
    const out = createRepoNameTexture('codecity');
    expect(out.aspect).toBeCloseTo(out.canvas.width / out.canvas.height);
  });

  it('redrawRepoName flags texture.needsUpdate when canvas width is unchanged', () => {
    // A redraw at the same width stays on the texture and bumps its version,
    // so three.js re-uploads through texSubImage2D.
    const out = createRepoNameTexture('codecity');
    const versionBefore = out.texture.version;
    const widthBefore = out.canvas.width;
    redrawRepoName(out, 'codecity');
    expect(out.canvas.width).toBe(widthBefore);
    expect(out.texture.version).toBeGreaterThan(versionBefore);
    expect(out.aspect).toBeCloseTo(out.canvas.width / out.canvas.height);
  });

  it('replaces out.texture when the canvas width changes', () => {
    // texStorage2D fixes a texture's dimensions for good (Texture.js says so),
    // so a wider redraw must swap in a fresh one or show stale pixels.
    const out = createRepoNameTexture('a');
    const oldTexture = out.texture;
    redrawRepoName(out, 'a-much-longer-repo-name-than-before');
    // Width must have grown for this to be a real cross-allocation case.
    expect(out.canvas.width).toBeGreaterThan(64);
    expect(out.texture).not.toBe(oldTexture);
  });

  it('reuses out.texture when the canvas width is unchanged', () => {
    // texSubImage2D covers a same-size update, so disposing every redraw
    // would churn the GPU allocation for nothing.
    const out = createRepoNameTexture('codecity');
    const oldTexture = out.texture;
    redrawRepoName(out, 'codecity');
    expect(out.texture).toBe(oldTexture);
  });

  it('still produces a texture for an empty name', () => {
    expect(createRepoNameTexture('').texture).toBeTruthy();
  });

  it('keeps the requested font size for names that fit at full FONT_PX', () => {
    // A short org/repo fits the 1024px cap at FONT_PX=80: the shrink path must
    // stay out of the common case.
    const { fontPx } = measureForName('foo/bar');
    expect(fontPx).toBe(80);
  });

  it('shrinks the font so long org/repo names fit without canvas clipping', () => {
    // A label this long exceeds MAX_WIDTH − 2·SIDE_PAD at FONT_PX=80 and used
    // to spill off both sides of the centred fillText.
    const longName = 'dependency-check/DependencyCheck';
    const { fontPx, canvasWidth } = measureForName(longName);
    expect(fontPx).toBeLessThan(80);
    expect(fontPx).toBeGreaterThanOrEqual(24);
    // Verify the chosen font actually fits the chosen canvas.
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) throw new Error('no 2d context');
    probe.font = `700 ${fontPx}px 'Orbitron', 'Eurostile', system-ui, sans-serif`;
    const width = probe.measureText(longName).width;
    // 64 = SIDE_PAD * 2.
    expect(width).toBeLessThanOrEqual(canvasWidth - 64);
  });
});

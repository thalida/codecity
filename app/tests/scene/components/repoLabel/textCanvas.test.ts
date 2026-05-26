import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRepoNameTexture, redrawRepoName } from '@/scene/components/repoLabel/textCanvas.js';

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
    // Width-preserving redraws (live-update poll with same name, or a
    // different name that happens to fit in the same nextPow2 bucket)
    // stay on the existing texture and rely on a version bump so three.js
    // re-uploads via texSubImage2D.
    const out = createRepoNameTexture('codecity');
    const versionBefore = out.texture.version;
    const widthBefore = out.canvas.width;
    redrawRepoName(out, 'codecity');
    expect(out.canvas.width).toBe(widthBefore);
    expect(out.texture.version).toBeGreaterThan(versionBefore);
    expect(out.aspect).toBeCloseTo(out.canvas.width / out.canvas.height);
  });

  it('replaces out.texture when the canvas width changes', () => {
    // Three.js cannot resize a Texture's GPU allocation once texStorage2D
    // has run — see Texture.js: "After the initial use of a texture, its
    // dimensions [...] cannot be changed. Instead, call Texture#dispose
    // [...] and instantiate a new one." So a redraw that bumps the canvas
    // width MUST swap out.texture for a fresh CanvasTexture; mutating in
    // place leaves stale pixels visible on the GPU.
    const out = createRepoNameTexture('a');
    const oldTexture = out.texture;
    redrawRepoName(out, 'a-much-longer-repo-name-than-before');
    // Width must have grown for this to be a real cross-allocation case.
    expect(out.canvas.width).toBeGreaterThan(64);
    expect(out.texture).not.toBe(oldTexture);
  });

  it('reuses out.texture when the canvas width is unchanged', () => {
    // texSubImage2D handles same-dimension updates fine — disposing the
    // texture every redraw would churn the GPU allocation for no reason
    // (e.g. live-update polls re-applying the same manifest).
    const out = createRepoNameTexture('codecity');
    const oldTexture = out.texture;
    redrawRepoName(out, 'codecity');
    expect(out.texture).toBe(oldTexture);
  });

  it('handles empty name without throwing', () => {
    expect(() => createRepoNameTexture('')).not.toThrow();
  });
});

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

  it('redrawRepoName mutates the existing canvas + flags texture.needsUpdate', () => {
    const out = createRepoNameTexture('codecity');
    const beforeWidth = out.canvas.width;
    // THREE.Texture.needsUpdate is a write-only setter that increments
    // texture.version — read back via version to verify the flag was raised.
    const versionBefore = out.texture.version;
    redrawRepoName(out, 'a-much-longer-repo-name-than-before');
    expect(out.texture.version).toBeGreaterThan(versionBefore);
    expect(out.canvas.width).toBeGreaterThanOrEqual(beforeWidth);
    expect(out.aspect).toBeCloseTo(out.canvas.width / out.canvas.height);
  });

  it('handles empty name without throwing', () => {
    expect(() => createRepoNameTexture('')).not.toThrow();
  });
});

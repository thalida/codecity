import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { createIslandMaterial } from '../../../src/components/island/islandShader';
import { settingsStore } from '../../_helpers/citySettings';

const SETTINGS = settingsStore();

describe('createIslandMaterial', () => {
  it('returns a ShaderMaterial with all required uniforms', () => {
    const mat = createIslandMaterial(SETTINGS);
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    const u = mat.uniforms;
    expect(u.uHemiSkyColor).toBeDefined();
    expect(u.uHemiGroundColor).toBeDefined();
    mat.dispose();
  });

  it('uHemiSkyColor and uHemiGroundColor are THREE.Color instances', () => {
    const mat = createIslandMaterial(SETTINGS);
    expect(mat.uniforms.uHemiSkyColor!.value).toBeInstanceOf(THREE.Color);
    expect(mat.uniforms.uHemiGroundColor!.value).toBeInstanceOf(THREE.Color);
    mat.dispose();
  });

  it('vertex + fragment shader sources reference vColor, vNormalWorld, and vAO', () => {
    const mat = createIslandMaterial(SETTINGS);
    expect(mat.vertexShader).toMatch(/vColor/);
    expect(mat.vertexShader).toMatch(/vNormalWorld/);
    expect(mat.vertexShader).toMatch(/vAO/);
    expect(mat.fragmentShader).toMatch(/vColor/);
    expect(mat.fragmentShader).toMatch(/vNormalWorld/);
    expect(mat.fragmentShader).toMatch(/vAO/);
    mat.dispose();
  });

  it('carries no ground-haze plumbing — the island opts out of fog entirely', () => {
    const mat = createIslandMaterial(SETTINGS);
    expect(mat.fragmentShader).not.toMatch(/applyFog|uFog/);
    expect(Object.keys(mat.uniforms)).not.toContain('uFogColor');
    mat.dispose();
  });

  // World position is the texture's sample coordinate, so the pattern belongs
  // to the ground rather than swimming with the camera.
  it('samples its texture on world position, per surface', () => {
    const mat = createIslandMaterial(SETTINGS);
    expect(mat.vertexShader).toMatch(/vWorldPos/);
    expect(mat.vertexShader).toMatch(/aSurface/);
    expect(mat.fragmentShader).toMatch(/vWorldPos\.xz/);
    expect(Object.keys(mat.uniforms)).toEqual(
      expect.arrayContaining(['uGrassTexture', 'uGrassPatchSize', 'uRockTexture', 'uRockPatchSize'])
    );
    mat.dispose();
  });

  it('fragment shader uses hemispheric blend (uHemiSkyColor, uHemiGroundColor)', () => {
    const mat = createIslandMaterial(SETTINGS);
    expect(mat.fragmentShader).toMatch(/uHemiSkyColor/);
    expect(mat.fragmentShader).toMatch(/uHemiGroundColor/);
    // Old sun-direction model must not be present.
    expect(mat.fragmentShader).not.toMatch(/uSunDirWorld/);
    expect(mat.fragmentShader).not.toMatch(/uSunContrast/);
    expect(mat.fragmentShader).not.toMatch(/uAmbient/);
    mat.dispose();
  });
});

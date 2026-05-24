import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { createIslandMaterial } from '@/scene/components/island/islandShader.js';

describe('createIslandMaterial', () => {
  it('returns a ShaderMaterial with all required uniforms', () => {
    const mat = createIslandMaterial();
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    const u = mat.uniforms;
    expect(u.uHemiSkyColor).toBeDefined();
    expect(u.uHemiGroundColor).toBeDefined();
    mat.dispose();
  });

  it('uHemiSkyColor and uHemiGroundColor are THREE.Color instances', () => {
    const mat = createIslandMaterial();
    expect(mat.uniforms.uHemiSkyColor!.value).toBeInstanceOf(THREE.Color);
    expect(mat.uniforms.uHemiGroundColor!.value).toBeInstanceOf(THREE.Color);
    mat.dispose();
  });

  it('vertex + fragment shader sources reference vColor, vNormalWorld, and vAO', () => {
    const mat = createIslandMaterial();
    expect(mat.vertexShader).toMatch(/vColor/);
    expect(mat.vertexShader).toMatch(/vNormalWorld/);
    expect(mat.vertexShader).toMatch(/vAO/);
    expect(mat.fragmentShader).toMatch(/vColor/);
    expect(mat.fragmentShader).toMatch(/vNormalWorld/);
    expect(mat.fragmentShader).toMatch(/vAO/);
    mat.dispose();
  });

  it('vertex + fragment shader sources reference vWorldPos for distance fog', () => {
    const mat = createIslandMaterial();
    expect(mat.vertexShader).toMatch(/vWorldPos/);
    expect(mat.fragmentShader).toMatch(/vWorldPos/);
    expect(mat.fragmentShader).toMatch(/applyFog/);
    mat.dispose();
  });

  it('fragment shader uses hemispheric blend (uHemiSkyColor, uHemiGroundColor)', () => {
    const mat = createIslandMaterial();
    expect(mat.fragmentShader).toMatch(/uHemiSkyColor/);
    expect(mat.fragmentShader).toMatch(/uHemiGroundColor/);
    // Old sun-direction model must not be present.
    expect(mat.fragmentShader).not.toMatch(/uSunDirWorld/);
    expect(mat.fragmentShader).not.toMatch(/uSunContrast/);
    expect(mat.fragmentShader).not.toMatch(/uAmbient/);
    mat.dispose();
  });
});

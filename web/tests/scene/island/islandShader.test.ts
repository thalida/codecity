import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { createIslandMaterial } from '@/scene/island/islandShader.js';

describe('createIslandMaterial', () => {
  it('returns a ShaderMaterial with all required uniforms', () => {
    const mat = createIslandMaterial();
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    const u = mat.uniforms;
    expect(u.uSunDirWorld).toBeDefined();
    expect(u.uSunContrast).toBeDefined();
    expect(u.uAmbient).toBeDefined();
    expect(u.uUnderglowColor).toBeDefined();
    expect(u.uUnderglowStrength).toBeDefined();
    mat.dispose();
  });

  it('uSunDirWorld is initialized to a unit vector', () => {
    const mat = createIslandMaterial();
    const v = mat.uniforms.uSunDirWorld!.value as THREE.Vector3;
    expect(v.length()).toBeCloseTo(1, 4);
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
});

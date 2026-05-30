import { describe, it, expect } from 'vitest';
import { FOG_UNIFORMS_GLSL, FOG_APPLY_GLSL } from '@/scene/components/lighting/fogChunk';

describe('fog GLSL chunks', () => {
  it('uniform declarations include height-fog symbols', () => {
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogEnabled/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogColor/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogIntensity/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogHeight/);
    expect(FOG_UNIFORMS_GLSL).not.toMatch(/uDistanceFog/);
  });

  it('apply chunk defines applyFog(vec3 color, vec3 worldPos) — no viewDist param', () => {
    expect(FOG_APPLY_GLSL).toMatch(/vec3 applyFog\(vec3 color, vec3 worldPos\)/);
    expect(FOG_APPLY_GLSL).toMatch(/uFogEnabled/);
    expect(FOG_APPLY_GLSL).not.toMatch(/uDistanceFog/);
  });
});

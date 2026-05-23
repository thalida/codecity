import { describe, it, expect } from 'vitest';
import { FOG_UNIFORMS_GLSL, FOG_APPLY_GLSL } from '@/scene/lighting/fogChunk.js';

describe('fog GLSL chunks', () => {
  it('uniform declarations include both height-fog and distance-fog symbols', () => {
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogEnabled/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogColor/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogIntensity/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogHeight/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uDistanceFogEnabled/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uDistanceFogColor/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uDistanceFogNear/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uDistanceFogFar/);
  });

  it('apply chunk defines applyFog(vec3 color, vec3 worldPos, float viewDist)', () => {
    expect(FOG_APPLY_GLSL).toMatch(/vec3 applyFog/);
    expect(FOG_APPLY_GLSL).toMatch(/uFogEnabled/);
    expect(FOG_APPLY_GLSL).toMatch(/uDistanceFogEnabled/);
  });
});

import { describe, it, expect } from 'vitest';
import { FOG_UNIFORMS_GLSL, FOG_APPLY_GLSL } from '@/city/utils/shaders/fogChunk';

describe('fog GLSL chunks', () => {
  it('uniform declarations include height-fog symbols', () => {
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogEnabled/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogColor/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogIntensity/);
    expect(FOG_UNIFORMS_GLSL).toMatch(/uFogHeightFrac/);
    expect(FOG_UNIFORMS_GLSL).not.toMatch(/uDistanceFog/);
  });

  it('apply chunk takes the reference height per call — no absolute-height uniform', () => {
    expect(FOG_APPLY_GLSL).toMatch(/vec3 applyFog\(vec3 color, vec3 worldPos, float refHeight\)/);
    expect(FOG_APPLY_GLSL).toMatch(/uFogHeightFrac \* refHeight/);
    expect(FOG_APPLY_GLSL).toMatch(/uFogEnabled/);
    expect(FOG_APPLY_GLSL).not.toMatch(/uDistanceFog/);
  });
});

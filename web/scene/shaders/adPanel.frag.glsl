// adPanel.frag.glsl — Fragment shader for instanced ad panels.
//
// Samples a single layer from the DataArrayTexture and blends it with a
// per-instance placeholder color. iTextureFade drives the blend factor:
//   0.0 → pure placeholder color (before image loads)
//   1.0 → full texture (after image has been uploaded and faded in)
//
// GLSL3 note: sampler2DArray + texture() are GLSL ES 3.00 / WebGL2 features.
// The material must set glslVersion: THREE.GLSL3.
//
// In GLSL3 mode Three.js maps `varying` → `in` (fragment) and expects
// `fragColor` output instead of `gl_FragColor`. Three.js sets up the
// `#define gl_FragColor fragColor` mapping automatically.

precision mediump float;
precision mediump sampler2DArray;

uniform sampler2DArray uPanelArray;

in vec2 vUv;
in float vLayerIndex;
in vec3 vColor;
in float vTextureFade;

out vec4 fragColor;

void main() {
  vec4 texSample = texture(uPanelArray, vec3(vUv, vLayerIndex));
  // Blend: at iTextureFade=0 show the placeholder color; at 1 show the texture.
  vec3 finalColor = mix(vColor, texSample.rgb, vTextureFade);
  // Use texture alpha blended toward 1.0 as fade advances, so a fully
  // transparent texture corner doesn't punch a hole before the image loads.
  float finalAlpha = mix(1.0, texSample.a, vTextureFade);
  fragColor = vec4(finalColor, finalAlpha);
}

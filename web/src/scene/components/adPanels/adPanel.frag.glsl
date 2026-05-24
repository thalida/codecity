// adPanel.frag.glsl — Fragment shader for instanced ad panels.
//
// Samples a single layer from one of N DataArrayTexture pages and blends
// it with a per-instance placeholder color. iTextureFade drives the
// blend factor:
//   0.0 → pure placeholder color (before image loads)
//   1.0 → full texture (after image has been uploaded and faded in)
//
// Paging: iLayerIndex is a flat layer index across all pages. The shader
// splits it into (page, localLayer) using uPageSize (= the hardware's
// MAX_ARRAY_TEXTURE_LAYERS) and picks the correct sampler via an
// if/else-if chain. The chain has AD_PANEL_MAX_PAGES branches; this
// #define is injected from JS (adPanelsInstanced.ts) so it stays in
// lockstep with the JS-side MAX_PAGES constant. WebGL2 GLSL ES 3.00
// requires sampler-array indices to be constant expressions, so dynamic
// `uPanelArrays[page]` is not allowed — the explicit branch chain is
// the conformant way to do this.
//
// GLSL3 note: sampler2DArray + texture() are GLSL ES 3.00 / WebGL2
// features. The material must set glslVersion: THREE.GLSL3.
//
// In GLSL3 mode Three.js maps `varying` → `in` (fragment) and expects
// `fragColor` output instead of `gl_FragColor`. Three.js sets up the
// `#define gl_FragColor fragColor` mapping automatically.

// highp, not mediump: the flat iLayerIndex can reach MAX_PAGES * pageSize
// (~16k); mediump float only represents integers exactly up to ~1024, so
// the page-decomposition arithmetic (`vLayerIndex / uPageSize`) would
// silently round to the wrong page for buildings on page 1+.
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uPanelArrays[AD_PANEL_MAX_PAGES];
uniform float uPageSize;

in vec2 vUv;
in highp float vLayerIndex;
in vec3 vColor;
in float vTextureFade;

out vec4 fragColor;

vec4 sampleLayer(int page, float localLayer) {
  // Constant-indexed sampler accesses — required by GLSL ES 3.00.
  // The branch count must equal AD_PANEL_MAX_PAGES (declared above).
  if (page == 0) return texture(uPanelArrays[0], vec3(vUv, localLayer));
  else if (page == 1) return texture(uPanelArrays[1], vec3(vUv, localLayer));
  else if (page == 2) return texture(uPanelArrays[2], vec3(vUv, localLayer));
  else if (page == 3) return texture(uPanelArrays[3], vec3(vUv, localLayer));
  else if (page == 4) return texture(uPanelArrays[4], vec3(vUv, localLayer));
  else if (page == 5) return texture(uPanelArrays[5], vec3(vUv, localLayer));
  else if (page == 6) return texture(uPanelArrays[6], vec3(vUv, localLayer));
  else return texture(uPanelArrays[7], vec3(vUv, localLayer));
}

void main() {
  int page = int(vLayerIndex / uPageSize);
  float localLayer = mod(vLayerIndex, uPageSize);
  vec4 texSample = sampleLayer(page, localLayer);
  // Blend: at iTextureFade=0 show the placeholder color; at 1 show the texture.
  vec3 finalColor = mix(vColor, texSample.rgb, vTextureFade);
  // Use texture alpha blended toward 1.0 as fade advances, so a fully
  // transparent texture corner doesn't punch a hole before the image loads.
  float finalAlpha = mix(1.0, texSample.a, vTextureFade);
  fragColor = vec4(finalColor, finalAlpha);
}

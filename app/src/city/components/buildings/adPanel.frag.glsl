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
// MAX_ARRAY_TEXTURE_LAYERS) and picks the correct sampler in
// sampleLayer(). Both page-count-shaped things derive from the ONE
// AD_PANEL_MAX_PAGES define (injected from MAX_PAGES in
// adPanelTextureArray.ts): the uPanelArrays size, and the sampleLayer
// loop bound. Nothing is hand-listed, so the count lives in one place.
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
uniform float uEmissionBoost;

in vec2 vUv;
in highp float vLayerIndex;
in vec3 vColor;
in float vTextureFade;
in float vBuildingFade;

out vec4 fragColor;

vec4 sampleLayer(int page, float localLayer) {
  // GLSL ES 3.00 forbids indexing a sampler array with a non-constant
  // expression, but a for-loop induction variable IS a constant-index-
  // expression — so this loop compiles to the same constant sampler
  // accesses an unrolled if/else chain would, without hand-listing one
  // branch per page. The bound is the injected AD_PANEL_MAX_PAGES define,
  // so the page count lives in exactly one place (MAX_PAGES,
  // adPanelTextureArray.ts). page is always in [0, AD_PANEL_MAX_PAGES)
  // by construction (the CPU cap keeps iLayerIndex < MAX_PAGES*pageSize),
  // so the trailing return is unreachable — present only to satisfy the
  // all-paths-return rule.
  for (int i = 0; i < AD_PANEL_MAX_PAGES; i++) {
    if (i == page) return texture(uPanelArrays[i], vec3(vUv, localLayer));
  }
  return vec4(0.0);
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
  // Selection-cascade body fade — multiplied in last so it dims the
  // panel by the same factor as its building body (see buildingFader).
  finalAlpha *= vBuildingFade;
  fragColor = vec4(finalColor * uEmissionBoost, finalAlpha);
}

// building.frag.glsl — Procedural facade rendering. Computes window
// and door geometry analytically from per-instance attributes and the
// face's UV coordinates. All anti-aliasing is via fwidth() / smoothstep()
// — no mipmaps available because there's no texture.
//
// Visual parity goal: byte-identical (within ~1% pixel tolerance) to
// the canvas-baked facade textures the previous renderer produced.
// See web/scene/engine.ts (pre-refactor) for the original logic.
//
// Color constants are sourced from the SHADING and FACADE objects in
// web/scene/engine.ts — if those values change, this shader must be
// updated to match. The mapping is documented in the constant comments.

#include <hsl_glsl_inline>

flat varying int vFace;
varying vec2 vUv;
flat varying vec2 vCols;
flat varying float vFloors;
flat varying float vOrient;
flat varying float vDoorWidth;
flat varying float vOpacity;
flat varying float vSilhouette;
flat varying float vOutlineOpacity;
flat varying vec3 vColor;
flat varying vec3 vScale;

// ---------------------------------------------------------------------------
// Facade geometry constants — sourced from FACADE in web/scene/engine.ts.
// ---------------------------------------------------------------------------

// FACADE.SLAB_HEIGHT_FRAC = 0.12 — slab strip height as fraction of one floor.
const float SLAB_HEIGHT_FRAC = 0.12;

// FACADE.WINDOW_WIDTH_FRAC = 0.45 — window width as fraction of one cell.
// Window is centered horizontally within the cell:
//   winLeft  = 0.5 - WINDOW_WIDTH_FRAC / 2 = 0.275
//   winRight = 0.5 + WINDOW_WIDTH_FRAC / 2 = 0.725
const float WINDOW_WIDTH_FRAC = 0.45;

// FACADE.WINDOW_HEIGHT_FRAC = 0.45 — window height as fraction of one floor.
// Window is centered vertically in the non-slab portion of the floor.
// The non-slab span in cellV is [0, 1 - SLAB_HEIGHT_FRAC].
// Window center in cellV: SLAB_HEIGHT_FRAC + (1 - SLAB_HEIGHT_FRAC) * 0.5
//                       = 0.12 + 0.44 = 0.56
//   winBottom = 0.56 - WINDOW_HEIGHT_FRAC / 2 = 0.335
//   winTop    = 0.56 + WINDOW_HEIGHT_FRAC / 2 = 0.785
const float WINDOW_HEIGHT_FRAC = 0.45;

// FACADE.WINDOW_MARGIN_FRAC = 0.08 — horizontal margin as fraction of face
// width, applied on both edges before dividing into columns. The window-column
// grid spans [WINDOW_MARGIN_FRAC, 1 - WINDOW_MARGIN_FRAC] of face width, not
// [0, 1]. Mirrors engine.ts: marginX = floor(width * 0.08), then
// cellW = (width - 2*marginX) / cols.
const float WINDOW_MARGIN_FRAC = 0.08;

// FACADE.DOOR_HEIGHT_FRAC = 0.7 — door height as fraction of one floor.
const float DOOR_HEIGHT_FRAC = 0.7;

// Roof border: engine.ts uses strokeRect(2, 2, 124, 124) with lineWidth=4 on
// a 128×128 canvas. Outer edge of the stroke is at 4px from canvas edge:
//   ROOF_BORDER_FRAC = 4 / 128 = 0.03125
const float ROOF_BORDER_FRAC = 0.03125;

// ---------------------------------------------------------------------------
// Color shading constants — sourced from SHADING in web/scene/engine.ts.
// *_LIGHTNESS_DELTA values: additive lightness shift in HSL % (0–100 domain).
// *_HUE_SHIFT values: hue rotation in degrees (0–360 domain).
// *_DARKEN_RATIO values: multiplicative factor applied to lightness.
// *_LIGHTNESS_FLOOR values: absolute lightness floor (0–100 domain).
//
// NOTE: engine.ts passes WALL_SIDE_LIGHTNESS_DELTA and SLAB_SIDE_LIGHTNESS_DELTA
// as the `hueDelta` argument to shadeByRatio — this appears to be intentional
// naming inconsistency in the JS source; the GLSL mirrors the same call semantics
// (deltaHueDeg = the *_LIGHTNESS_DELTA value, not a separate hue shift).
// ---------------------------------------------------------------------------

// SHADING.WALL_FRONT_LIGHTNESS_DELTA = -5
const float WALL_FRONT_LIGHTNESS_DELTA = -5.0;
// SHADING.WALL_FRONT_HUE_SHIFT = 18
const float WALL_FRONT_HUE_SHIFT = 18.0;
// SHADING.WALL_SIDE_DARKEN_RATIO = 0.55
const float WALL_SIDE_DARKEN_RATIO = 0.55;
// SHADING.WALL_SIDE_LIGHTNESS_DELTA = -10 (passed as hueDelta in shadeByRatio)
const float WALL_SIDE_LIGHTNESS_DELTA = -10.0;
// SHADING.WALL_SIDE_LIGHTNESS_FLOOR = 14
const float WALL_SIDE_LIGHTNESS_FLOOR = 14.0;

// SHADING.SLAB_FRONT_LIGHTNESS_DELTA = -15
const float SLAB_FRONT_LIGHTNESS_DELTA = -15.0;
// SHADING.SLAB_FRONT_HUE_SHIFT = 18
const float SLAB_FRONT_HUE_SHIFT = 18.0;
// SHADING.SLAB_SIDE_DARKEN_RATIO = 0.4
const float SLAB_SIDE_DARKEN_RATIO = 0.4;
// SHADING.SLAB_SIDE_LIGHTNESS_DELTA = -10 (passed as hueDelta in shadeByRatio)
const float SLAB_SIDE_LIGHTNESS_DELTA = -10.0;
// SHADING.SLAB_SIDE_LIGHTNESS_FLOOR = 10
const float SLAB_SIDE_LIGHTNESS_FLOOR = 10.0;

// SHADING.WINDOW_LIGHTNESS_DELTA = 20
const float WINDOW_LIGHTNESS_DELTA = 20.0;
// SHADING.DOOR_LIGHTNESS_DELTA = -55
const float DOOR_LIGHTNESS_DELTA = -55.0;
// SHADING.ROOF_BORDER_LIGHTNESS_DELTA = -15
const float ROOF_BORDER_LIGHTNESS_DELTA = -15.0;

// ---------------------------------------------------------------------------
// Face helpers
// ---------------------------------------------------------------------------

bool isDoorFace() {
  // vOrient: 0=S(+Z=face4), 1=N(-Z=face5), 2=E(+X=face0), 3=W(-X=face1)
  if (vOrient < 0.5) return vFace == 4;
  if (vOrient < 1.5) return vFace == 5;
  if (vOrient < 2.5) return vFace == 0;
  return vFace == 1;
}

bool isFrontFacePair() {
  // Front pair = the pair containing the door face.
  bool doorOnEW = vOrient >= 1.5; // E or W orient
  if (doorOnEW) return vFace == 0 || vFace == 1;
  return vFace == 4 || vFace == 5;
}

// ---------------------------------------------------------------------------
// Edge helpers — hard step to match the canvas-baked reference (NearestFilter
// textures have no sub-pixel smoothing; hard step gives the same result).
// ---------------------------------------------------------------------------

// aastep: hard step matching canvas NearestFilter (no sub-pixel smoothing).
float aastep(float edge, float x) {
  return step(edge, x);
}

// aaband: returns 1 inside [a, b], 0 outside, hard edges.
float aaband(float a, float b, float x) {
  return step(a, x) * (1.0 - step(b, x));
}

// ---------------------------------------------------------------------------
// Face renderers
// ---------------------------------------------------------------------------

vec4 renderWallFace() {
  bool front = isFrontFacePair();

  // instanceColor arrives as linear-sRGB (Three.js Color.set() converts CSS
  // sRGB strings to linear). The HSL shading helpers are ported from hsl.ts
  // which works in sRGB percentage space.
  //
  // ShaderMaterial does NOT get Three.js's automatic linearToOutputTexel()
  // injection, so gl_FragColor is written directly to the sRGB framebuffer
  // (drawingBufferColorSpace = 'srgb'). We therefore:
  //   1. Convert vColor linear → sRGB so HSL math works correctly.
  //   2. Perform HSL shading in sRGB.
  //   3. Write the sRGB result directly (no re-linearisation needed).
  vec3 baseColor = linearToSrgb(vColor);

  // Wall color: front faces use additive lightness + hue shift;
  // side faces use multiplicative darkening with a lightness floor.
  // Mirrors engine.ts shadeAndShiftHue / shadeByRatio calls exactly.
  // Note: *_LIGHTNESS_DELTA constants are passed as deltaHueDeg to
  // shadeByRatio — this mirrors the engine.ts call semantics where
  // WALL_SIDE_LIGHTNESS_DELTA / SLAB_SIDE_LIGHTNESS_DELTA are the 3rd
  // positional arg (hueDelta) of shadeByRatio.
  vec3 wallColor = front
    ? shadeAndShiftHue(baseColor, WALL_FRONT_LIGHTNESS_DELTA, WALL_FRONT_HUE_SHIFT, -1.0)
    : shadeByRatio(baseColor, WALL_SIDE_DARKEN_RATIO, WALL_SIDE_LIGHTNESS_DELTA, WALL_SIDE_LIGHTNESS_FLOOR);
  vec3 slabColor = front
    ? shadeAndShiftHue(baseColor, SLAB_FRONT_LIGHTNESS_DELTA, SLAB_FRONT_HUE_SHIFT, -1.0)
    : shadeByRatio(baseColor, SLAB_SIDE_DARKEN_RATIO, SLAB_SIDE_LIGHTNESS_DELTA, SLAB_SIDE_LIGHTNESS_FLOOR);
  vec3 winColor  = shadeColor(baseColor, WINDOW_LIGHTNESS_DELTA);
  vec3 doorColor = shadeAndShiftHue(baseColor, DOOR_LIGHTNESS_DELTA, 0.0, -1.0);

  // vCols.x = cols_ew (for ±X faces), vCols.y = cols_ns (for ±Z faces).
  float cols = (vFace == 0 || vFace == 1) ? vCols.x : vCols.y;

  // UV: (0,0) = bottom-left of face, (1,1) = top-right.
  vec2 uv = vUv;

  // Rescale x-UV to exclude the face-level horizontal margin on each edge.
  // The window-column grid occupies [WINDOW_MARGIN_FRAC, 1-WINDOW_MARGIN_FRAC]
  // of face width, matching engine.ts: marginX = floor(width * 0.08),
  // cellW = (width - 2*marginX) / cols, cellCenterX = marginX + cellW*(c+0.5).
  float uvEffX = (uv.x - WINDOW_MARGIN_FRAC) / (1.0 - 2.0 * WINDOW_MARGIN_FRAC);

  // Cell coordinates: integer cell index + intra-cell UV in [0,1].
  float colF   = uvEffX * cols;
  float colIdx = floor(colF);
  float cellU  = fract(colF);
  float rowF   = uv.y * vFloors;
  float row    = floor(rowF);
  float cellV  = fract(rowF);

  // Window rectangle within each cell, centered horizontally and
  // vertically above the slab band. Matches WINDOW_WIDTH_FRAC /
  // WINDOW_HEIGHT_FRAC usage in _buildFacadeTexture.
  float halfW    = WINDOW_WIDTH_FRAC * 0.5;
  float winLeft  = 0.5 - halfW;
  float winRight = 0.5 + halfW;

  float nonSlabH  = 1.0 - SLAB_HEIGHT_FRAC;
  float winCenter = SLAB_HEIGHT_FRAC + nonSlabH * 0.5; // center in non-slab span
  float halfH     = WINDOW_HEIGHT_FRAC * 0.5;
  float winBottom = winCenter - halfH;
  float winTop    = winCenter + halfH;

  // Gate winMask to zero in the horizontal margin strips (uvEffX outside [0,1])
  // so the margin areas show plain wall color, matching the JS canvas output.
  float inMargin = step(0.0, uvEffX) * step(uvEffX, 1.0);
  float winMask  = aaband(winLeft, winRight, cellU) * aaband(winBottom, winTop, cellV) * inMargin;

  // Slab strip at the top of each floor (cellV approaching 1.0).
  float slabMask = aastep(1.0 - SLAB_HEIGHT_FRAC, cellV);

  // Compose: slab overrides wall; window overrides slab+wall.
  vec3 wallOut  = mix(wallColor, slabColor, slabMask);
  vec3 withWin  = mix(wallOut, winColor, winMask);

  // Door: ground floor of the door face only. Replaces windows for that row.
  if (isDoorFace() && row < 0.5) {
    // Door world-width / face world-width = door UV width.
    // vScale = (w, h, d) recovered from instance matrix columns.
    // ±X faces span depth d (vScale.z); ±Z faces span width w (vScale.x).
    float faceWorldWidth = (vFace == 0 || vFace == 1) ? vScale.z : vScale.x;
    float doorUvWidth  = vDoorWidth / faceWorldWidth;
    float doorLeft     = 0.5 - doorUvWidth * 0.5;
    float doorRight    = 0.5 + doorUvWidth * 0.5;
    float doorTopV     = DOOR_HEIGHT_FRAC / vFloors; // fraction of total face height
    float doorMask = aaband(doorLeft, doorRight, uv.x)
                   * aaband(0.0, doorTopV, uv.y);
    withWin = mix(withWin, doorColor, doorMask);
  }

  // withWin is already in sRGB — write directly to the sRGB framebuffer.
  return vec4(withWin, vOpacity);
}

vec4 renderRoofFace() {
  // Flat roof color with a darker border strip along all four edges.
  // Mirrors engine.ts _buildRoofTexture: strokeRect(2, 2, 124, 124) with
  // lineWidth=4 on a 128×128 canvas → border fraction ≈ 4/128 = 0.03125.
  //
  // Convert linear→sRGB for HSL math, write sRGB result directly to framebuffer
  // (ShaderMaterial has no automatic linearToOutputTexel pass).
  vec3 baseColor   = linearToSrgb(vColor);
  vec3 roofColor   = baseColor;
  vec3 borderColor = shadeAndShiftHue(baseColor, ROOF_BORDER_LIGHTNESS_DELTA, 0.0, -1.0);
  float innerMask  = aaband(ROOF_BORDER_FRAC, 1.0 - ROOF_BORDER_FRAC, vUv.x)
                   * aaband(ROOF_BORDER_FRAC, 1.0 - ROOF_BORDER_FRAC, vUv.y);
  float borderMask = 1.0 - innerMask;
  return vec4(mix(roofColor, borderColor, borderMask), vOpacity);
}

vec4 renderBottomFace() {
  // Bottom face is rarely visible; uses the side-wall palette (darkened).
  // Mirrors engine.ts bottomMat() which uses wallEW = wallSide when !doorOnEW,
  // or wallFront when doorOnEW. For simplicity we always use the side color
  // since it's the more conservative (darker) of the two.
  //
  // Convert linear→sRGB for HSL math, write sRGB result directly to framebuffer
  // (ShaderMaterial has no automatic linearToOutputTexel pass).
  vec3 baseColor = linearToSrgb(vColor);
  vec3 bottomColor = shadeByRatio(baseColor, WALL_SIDE_DARKEN_RATIO,
                                  WALL_SIDE_LIGHTNESS_DELTA,
                                  WALL_SIDE_LIGHTNESS_FLOOR);
  return vec4(bottomColor, vOpacity);
}

// Silhouette mode: render the proper face-shaded base color but skip
// per-cell window/door/slab/roof-border math. Walls keep front-vs-side
// shading so the building still reads as 3D; roof keeps its base color
// without the border stroke.
vec4 renderSilhouette() {
  vec3 baseColor = linearToSrgb(vColor);
  if (vFace == 2) {
    // Roof — solid base color.
    return vec4(baseColor, vOpacity);
  }
  if (vFace == 3) {
    // Bottom — match the side-wall darkening so silhouette looks consistent
    // with the wall sides if the camera ever sees underneath.
    vec3 c = shadeByRatio(baseColor, WALL_SIDE_DARKEN_RATIO,
                          WALL_SIDE_LIGHTNESS_DELTA,
                          WALL_SIDE_LIGHTNESS_FLOOR);
    return vec4(c, vOpacity);
  }
  // Walls — front pair vs side pair shading, matching renderWallFace().
  bool front = isFrontFacePair();
  vec3 wallColor = front
    ? shadeAndShiftHue(baseColor, WALL_FRONT_LIGHTNESS_DELTA, WALL_FRONT_HUE_SHIFT, -1.0)
    : shadeByRatio(baseColor, WALL_SIDE_DARKEN_RATIO, WALL_SIDE_LIGHTNESS_DELTA, WALL_SIDE_LIGHTNESS_FLOOR);
  return vec4(wallColor, vOpacity);
}

// Composite a per-instance wireframe over the body color. The "wire" is a
// thin band along each face's UV boundary (= the cube's edges), with width
// scaled by fwidth so it stays roughly constant in screen-space pixels.
// Used by the Hidden tier (body alpha = 0) to draw just the building's
// silhouette edges so the road behind shows through.
vec4 compositeOutline(vec4 body) {
  if (vOutlineOpacity < 0.001) return body;
  float distToEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float w = max(fwidth(distToEdge), 0.0001);
  float edge = 1.0 - smoothstep(w, w * 2.5, distToEdge);
  if (edge < 0.001) return body;
  // Outline color: darkened version of the building's base, so the wire
  // reads as that building's tint without needing a separate uniform.
  vec3 outlineColor = shadeByRatio(linearToSrgb(vColor), 0.3, 0.0, 5.0);
  float oa = clamp(vOutlineOpacity * edge, 0.0, 1.0);
  // Porter-Duff "over": outline (oa) on top of body (body.a).
  float aOut = oa + body.a * (1.0 - oa);
  if (aOut < 0.0001) return vec4(0.0);
  vec3 cOut = (outlineColor * oa + body.rgb * body.a * (1.0 - oa)) / aOut;
  return vec4(cOut, aOut);
}

void main() {
  vec4 body;
  if (vSilhouette > 0.5)      body = renderSilhouette();
  else if (vFace == 2)        body = renderRoofFace();
  else if (vFace == 3)        body = renderBottomFace();
  else                        body = renderWallFace();
  gl_FragColor = compositeOutline(body);
}

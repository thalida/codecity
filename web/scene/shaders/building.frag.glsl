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
// World-space face normal from the vertex shader. Used as the sun
// vector for the Lambert term in the new directional lighting model
// (replaced the front/side branch shading). Not declared `flat` —
// it's constant across each face anyway because the geometry is
// axis-aligned box, but leaving it interpolated keeps the shader
// portable if the geometry ever becomes non-box.
varying vec3 vWorldNormal;
flat varying vec2 vCols;
flat varying float vFloors;
flat varying float vOrient;
flat varying float vDoorWidth;
flat varying float vOpacity;
flat varying float vSilhouette;
flat varying float vOutlineOpacity;
flat varying vec3 vColor;
flat varying vec3 vScale;
// .xy = atlas UV for the file icon (or (-1,-1) for "no icon"),
// .z  = per-file random in [0, 1] driving the window gap / lit hash.
flat varying vec3 vIconUV;

// Hidden-tier wireframe thickness in screen-pixels. Sourced from
// BUILDING_OUTLINE.WIDTH; refreshed via refreshBuildingMaterial() on hot-reload.
uniform float uOutlineWidth;

// File-icon atlas + UV size of one slot in atlas-UV units. Sampled in
// renderRoofFace; gated by vIconUV.x >= 0 so buildings whose file
// type didn't make it into the atlas keep their plain roof color.
uniform sampler2D uIconAtlas;
uniform float uIconSlotSize;

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
// Lighting — single world-space directional light + ambient. Replaces the
// previous front/side branch shading: facade tone now comes from
// dot(worldNormal, sun) rather than from whether a given face was the
// door face. North/south/east/west-facing walls light up consistently
// across the whole city regardless of which way each building's door
// points. Numbers tuned so the lit side reads as "in the sun" while
// the shaded side stays legible (not crushed to black).
// ---------------------------------------------------------------------------

// Cyberpunk lighting: ambient dominates so the dark side of buildings
// stays atmospheric / readable rather than crushed to black. The sun is
// kept as a subtle directional cue so the buildings still read as 3D,
// but most of the "wow" comes from emissive windows, not from sunlight.
const vec3 SUN_DIR_WORLD = normalize(vec3(0.5, 1.0, 0.4)); // upper-right
const float AMBIENT = 0.72;     // base illumination on faces facing away from the sun
const float DIFFUSE_GAIN = 0.28; // additional brightening on faces facing the sun

// Slabs (the strip at the top of each floor) sit slightly darker than
// the wall, regardless of light direction, so the floor seams read.
const float SLAB_LIGHTNESS_DELTA = -12.0;

// Lit windows are treated as EMISSIVE — they bypass the directional
// lighting multiplier and push the base color close to white in HSL
// space so they glow like neon panes on the shadow side too.
const float WINDOW_LIGHTNESS_DELTA = 55.0;
// Dimmer brightness applied to "unlit" windows in the same cell — picked
// per cell by a hash so each building has its own scatter of lit /
// unlit windows. Smaller than WINDOW_LIGHTNESS_DELTA but still positive
// so the window pane reads as a pane (not just blank wall).
const float WINDOW_UNLIT_LIGHTNESS_DELTA = 4.0;
// Baseline fraction of cells (per face) that have no window at all —
// irregular gaps so the facade reads as varied instead of a perfect
// grid. Old / dim buildings boost this further so they look boarded-up
// (see renderWallFace).
const float WINDOW_GAP_BASE_THRESHOLD = 0.18;
// Extra gap fraction added for the dimmest buildings — at brightness=0
// roughly half the cells become empty, reading as derelict / rundown.
const float WINDOW_GAP_AGE_BONUS = 0.32;
// (The lit-vs-unlit threshold is computed per-fragment from the
// building's brightness rather than being a fixed constant — see
// renderWallFace for the formula.)
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

// ---------------------------------------------------------------------------
// Edge helpers — screen-space anti-aliased step / band.
//
// Each helper takes an explicit half-width `w`, NOT fwidth(x) computed
// internally. Reason: many call sites pass `fract(...)` coordinates
// (cellU, cellV) where fwidth would explode at cell boundaries — a 2×2
// pixel quad spanning the boundary sees fract jump from ~1 to 0, and
// fwidth reports ~1 for the whole quad, blurring the smoothstep across
// the entire cell. Callers compute `w` from the underlying continuous
// coordinate (e.g. fwidth(colF) before the fract) so derivatives stay
// well-defined across cell boundaries.
// ---------------------------------------------------------------------------

float aastep(float edge, float x, float w) {
  float ww = max(w, 1e-6);
  return smoothstep(edge - ww, edge + ww, x);
}

// aaband: returns ~1 inside [a, b], ~0 outside, with `w`-wide falloff.
float aaband(float a, float b, float x, float w) {
  float ww = max(w, 1e-6);
  return smoothstep(a - ww, a + ww, x) * (1.0 - smoothstep(b - ww, b + ww, x));
}

// Standard sin-fract pseudo-random — deterministic per (col, row, seed)
// so a given building's window pattern is stable across frames and
// across the dual-mesh detail / silhouette swap. Sufficient for visual
// randomness; not for anything that needs statistical quality.
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// ---------------------------------------------------------------------------
// Face renderers
// ---------------------------------------------------------------------------

vec4 renderWallFace() {
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

  // Directional sun + ambient. Faces are flat-lit (each face has a
  // constant world-space normal because buildings aren't rotated), so
  // the silhouette still reads as 3D but the lit/shaded sides depend
  // on which compass direction each face points — not on which face
  // happens to be the door. North/south/east/west-facing walls light
  // up consistently across the whole city.
  float lambert = max(dot(normalize(vWorldNormal), SUN_DIR_WORLD), 0.0);
  float lightFactor = AMBIENT + DIFFUSE_GAIN * lambert;

  vec3 wallColor = baseColor * lightFactor;
  vec3 slabColor = shadeColor(baseColor, SLAB_LIGHTNESS_DELTA) * lightFactor;
  // Door stays a dark rectangle — small ambient response so it's not pitch-black
  // on sun-side walls but still reads as "open doorway".
  vec3 doorColor = shadeAndShiftHue(baseColor, DOOR_LIGHTNESS_DELTA, 0.0, -1.0) * (AMBIENT + DIFFUSE_GAIN * lambert * 0.4);
  // winColor is picked per-cell below — each cell hashes to "lit" or
  // "unlit" so the facade doesn't read as a copy-paste grid.

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

  // Screen-space derivatives for AA. Computed from the CONTINUOUS coords
  // (colF, rowF) before fract — fwidth(fract(x)) blows up at integer
  // boundaries (the 2×2 quad sees fract jump from ~1 to 0, fwidth → 1)
  // which would smear the smoothstep across whole cells.
  float wU = fwidth(colF) * 0.5;
  float wV = fwidth(rowF) * 0.5;

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
  // Suppress windows on the bottom floor of the door face — the door takes
  // that whole row, and otherwise the door rectangle clips into the windows
  // (door is 0.7 of one floor tall, window center sits at 0.56 of one floor
  // → vertical overlap regardless of horizontal position).
  float bottomDoorRow = (isDoorFace() && row < 0.5) ? 0.0 : 1.0;
  // Per-cell randomness — gap (window missing) + lit (brighter/dimmer
  // window pane). Seeded by the per-instance seed (stable hash of
  // file.path, packed into vIconUV.z) + vFace so every building gets
  // its own scatter even when colors collide (e.g. all .css files of
  // similar age share a hue and lightness) and the four faces don't
  // mirror each other.
  float buildingSeed = vIconUV.z * 1000.0 + float(vFace) * 11.0;
  vec2 cellKey = vec2(colIdx, row) + vec2(buildingSeed, buildingSeed * 1.7);
  float gapHash = hash21(cellKey);
  float litHash = hash21(cellKey + vec2(31.4, 17.7));
  // Building brightness drives both the lit-window probability AND the
  // window-gap density: oldest (dimmest) buildings read as boarded-up
  // tenements — most cells empty, none of the remaining windows lit.
  // Newest (brightest) buildings keep the baseline gap rate and most
  // windows are lit. Brightness is the simple sRGB-channel mean.
  float brightness = (baseColor.r + baseColor.g + baseColor.b) / 3.0;
  float ageGapThreshold = WINDOW_GAP_BASE_THRESHOLD + (1.0 - brightness) * WINDOW_GAP_AGE_BONUS;
  float gapMask = step(ageGapThreshold, gapHash);
  float winMask  = aaband(winLeft, winRight, cellU, wU) * aaband(winBottom, winTop, cellV, wV) * inMargin * bottomDoorRow * gapMask;

  // Lit cells get the full WINDOW_LIGHTNESS_DELTA boost and BYPASS the
  // directional-lighting multiplier — they're treated as emissive
  // neon panes, so a lit window on the shadow side still glows. Unlit
  // cells stay reflective (modulated by the sun) so they read as "off"
  // glass rather than blank wall.
  //
  // The lit / unlit split scales with the building's overall brightness:
  // a bright (new / saturated) building has a low threshold and most
  // windows lit ("buzzing"); at brightness=0 the threshold reaches 1.0
  // so step() returns 0 for every cell and no window is lit at all —
  // the oldest building's windows are all dark panes.
  float litThreshold = clamp(1.0 - brightness, 0.05, 1.0);
  float litFactor = step(litThreshold, litHash);
  vec3 winLitColor = shadeColor(baseColor, WINDOW_LIGHTNESS_DELTA);
  vec3 winUnlitColor = shadeColor(baseColor, WINDOW_UNLIT_LIGHTNESS_DELTA) * lightFactor;
  vec3 winColor = mix(winUnlitColor, winLitColor, litFactor);

  // Slab strip at the top of each floor (cellV approaching 1.0).
  float slabMask = aastep(1.0 - SLAB_HEIGHT_FRAC, cellV, wV);

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
    float doorMask = aaband(doorLeft, doorRight, uv.x, fwidth(uv.x) * 0.5)
                   * aaband(0.0, doorTopV, uv.y, fwidth(uv.y) * 0.5);
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
  float innerMask  = aaband(ROOF_BORDER_FRAC, 1.0 - ROOF_BORDER_FRAC, vUv.x, fwidth(vUv.x) * 0.5)
                   * aaband(ROOF_BORDER_FRAC, 1.0 - ROOF_BORDER_FRAC, vUv.y, fwidth(vUv.y) * 0.5);
  float borderMask = 1.0 - innerMask;
  vec3 composed = mix(roofColor, borderColor, borderMask);

  // File-type icon overlay. Skip when this instance has no atlas slot
  // (iIconUV negative) or when the atlas hasn't loaded yet (slotSize 0).
  // The icon fills the inner roof area (the border band stays visible
  // around it); the SVG's own alpha controls how aggressively it
  // overrides the base roof color.
  if (vIconUV.x >= 0.0 && uIconSlotSize > 0.0) {
    // Inset the icon inside the border so it doesn't clip the dark strip.
    float pad = ROOF_BORDER_FRAC;
    vec2 inset = clamp((vUv - pad) / (1.0 - 2.0 * pad), 0.0, 1.0);
    // Rotate so the icon's "top" lands at the building's far edge from
    // the door — readable to someone standing in front of the door and
    // looking at the building. Roof UVs are laid out:
    //   uv = (0, 0) = south-west, (1, 0) = south-east,
    //        (0, 1) = north-west, (1, 1) = north-east
    // Icon atlas Y is canvas-native (flipY=false): atlasUv.y=0 is the
    // icon's top edge. So "icon top → far edge from door" means
    // mapping the far edge's vUv to rotated.y=0.
    vec2 rotated;
    if (vOrient < 0.5)      rotated = vec2(inset.x, 1.0 - inset.y); // door S → top→N
    else if (vOrient < 1.5) rotated = vec2(1.0 - inset.x, inset.y); // door N → top→S
    else if (vOrient < 2.5) rotated = vec2(1.0 - inset.y, inset.x); // door E → top→W
    else                    rotated = vec2(inset.y, 1.0 - inset.x); // door W → top→E
    vec2 atlasUv = vIconUV.xy + rotated * uIconSlotSize;
    vec4 icon = texture2D(uIconAtlas, atlasUv);
    // Composite over the roof: icon.rgb on top, alpha-weighted.
    composed = mix(composed, icon.rgb, icon.a * innerMask);
  }

  return vec4(composed, vOpacity);
}

vec4 renderBottomFace() {
  // Bottom face is rarely visible; it points straight down so the sun's
  // lambert term goes to zero and we render at pure ambient.
  vec3 baseColor = linearToSrgb(vColor);
  return vec4(baseColor * AMBIENT, vOpacity);
}

// Silhouette mode: render the proper face-shaded base color but skip
// per-cell window/door/slab/roof-border math. Walls and bottom use the
// same directional-light formula as the detail tier so a silhouette
// building reads consistently when the camera transitions between LODs.
vec4 renderSilhouette() {
  vec3 baseColor = linearToSrgb(vColor);
  if (vFace == 2) {
    // Roof — solid base color, no directional shading (matches detail tier).
    return vec4(baseColor, vOpacity);
  }
  float lambert = max(dot(normalize(vWorldNormal), SUN_DIR_WORLD), 0.0);
  float lightFactor = AMBIENT + DIFFUSE_GAIN * lambert;
  return vec4(baseColor * lightFactor, vOpacity);
}

// Composite a per-instance wireframe over the body color. The "wire" is a
// thin band along each face's UV boundary (= the cube's edges), with width
// scaled by fwidth so it stays roughly constant in screen-space pixels.
// Used by the Hidden tier (body alpha = 0) to draw just the building's
// silhouette edges so the road behind shows through.
vec4 compositeOutline(vec4 body) {
  if (vOutlineOpacity < 0.001) return body;
  float distToEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  // Band width derived from screen-pixel size: fwidth(distToEdge) is the
  // UV-distance per screen-pixel, so multiplying by uOutlineWidth (pixels)
  // gives a band roughly that many pixels thick. Halved because smoothstep
  // below extends the visible band ~2.5× the inner edge (matches the
  // perceived thickness of the old `fwidth` band at uOutlineWidth=2).
  // Cap at 2% of face: fwidth() blows up on oblique faces and without a
  // ceiling the "outline" turns into a fill across the whole face.
  float pixelUv = max(fwidth(distToEdge), 1e-6);
  float w = min(pixelUv * uOutlineWidth * 0.5, 0.02);
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

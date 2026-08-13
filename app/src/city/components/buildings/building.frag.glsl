// building.frag.glsl — Procedural facade rendering. Computes window
// and door geometry analytically from per-instance attributes and the
// face's UV coordinates. All anti-aliasing is via fwidth() / smoothstep()
// — no mipmaps available because there's no texture.
//
// Color constants are sourced from the SHADING and FACADE objects in
// app/config — if those values change, this shader must be updated to
// match. The mapping is documented in the per-constant comments below.

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
// .z  = per-file random in [0, 1] driving the window gap / lit hash,
// .w  = createdAge in [0, 1] — 0=newest file, 1=oldest. Drives grime
//        independently of modifiedAge so old-but-recently-edited
//        files still look weathered.
flat varying vec4 vIconUV;
flat varying float vModifiedAge; // 0=most recently modified, 1=longest-untouched. Drives lit-window count + HDR emission via recencyCurve.
flat varying int vKind;          // Render-mode enum (BuildingKind).
flat varying vec3 vRefColor;     // un-aged colour (linear RGB), for the roof border
const int KIND_NORMAL = 0;
const int KIND_RUIN = 1;   // crumbled stub (Timeline)
const int KIND_FUTURE = 2; // blank slab (Timeline)
const int KIND_DATA = 3;   // windowless binary facade
const int KIND_EMPTY = 4;  // 0-byte file → flat slab

// Face indices (BoxGeometry material-slot order), mirroring building.vert.
const int FACE_EAST = 0;   // +X
const int FACE_WEST = 1;   // -X
const int FACE_ROOF = 2;   // +Y
const int FACE_BOTTOM = 3; // -Y
const int FACE_SOUTH = 4;  // +Z
const int FACE_NORTH = 5;  // -Z

bool isWallFace() { return vFace != FACE_ROOF && vFace != FACE_BOTTOM; }
bool isEastWest() { return vFace == FACE_EAST || vFace == FACE_WEST; }

// Ghost-ruin decay tuning (all by eye).
const float RUIN_FACE_SEED = 7.0;    // per-face hash offset so the 4 walls differ
const float RUIN_BRICK_CELLS = 11.0; // hashed cells per face for the missing-brick holes
const float RUIN_HOLE_CHANCE = 0.09; // fraction of brick cells punched out
const float RUIN_RIM_MIN = 0.86;     // jagged top nibble starts this far up the face
const float RUIN_RIM_JITTER = 0.14;  // ...varying the rest of the way to the roof line
const float RUIN_RIM_CELLS = 9.0;    // horizontal cells across the top rim
const float RUIN_GRIME_CELLS = 9.0;  // coarse grime cell grid
const float RUIN_GRIME_FLOOR = 0.7;  // grime darkens to 0.7x at most...
const float RUIN_GRIME_RANGE = 0.3;  // ...up to 1.0x (no darkening)
const float RUIN_X_DIAG = 0.70710678; // sqrt(2)/2: stroke width -> half-distance along |x-y|

// Hidden-tier wireframe thickness in screen-pixels. Sourced from
// BUILDING_OUTLINE.WIDTH; refreshed via refreshBuildingMaterial() on Save via applyTheme().
uniform float uOutlineWidth;

// File-icon atlas + UV size of one slot in atlas-UV units. Sampled in
// renderRoofFace; gated by vIconUV.x >= 0 so buildings whose file
// type didn't make it into the atlas keep their plain roof color.
uniform sampler2D uIconAtlas;
uniform float uIconSlotSize;

// Age-driven grime parameters, each a [newest, oldest] range the shader
// lerps per-building by createdAge (vIconUV.w). uGrimeIntensity scales the
// per-pixel darkening (its newest end at 0 leaves new facades clean);
// uGrimeCoverage is the fraction of vertical bands that streak. Both
// refreshed by refreshBuildingMaterial from BUILDINGS (aging) config.
uniform vec2 uGrimeIntensity;
uniform vec2 uGrimeCoverage;

// Ground haze — uFogEnabled / uFogColor / uFogIntensity / uFogHeightFrac plus
// applyFog(), all from the shared chunk.
#include <fog_glsl_inline>

// Scene directional lighting — replaces SUN_DIR_WORLD / AMBIENT / DIFFUSE_GAIN.
// Sun direction is in world space and points TOWARD the sun (positive
// dot(normal, uSunDirWorld) means the face lights up). Refreshed via
// refreshBuildingMaterial() from the LIGHTING store.
uniform vec3 uSunDirWorld;
uniform float uAmbient;
uniform float uSunContrast;

// Facade geometry — refreshed via refreshBuildingMaterial() from FACADE_GEOMETRY store.
uniform float uSlabHeightFrac;
uniform float uWindowWidthFrac;
uniform float uWindowHeightFrac;
uniform float uWindowMarginFrac;
uniform float uDoorHeightFrac;
uniform float uRoofBorderFrac;

// Facade detail shading — refreshed via refreshBuildingMaterial() from FACADE_DETAIL store.
uniform float uSlabLightnessDelta;
uniform float uDoorLightnessDelta;

// Deleted-file cross over the roof icon (RUINS store, Timeline only).
uniform bool uRuinXEnabled;
uniform vec3 uRuinXColor;
uniform float uRuinXWidth;

// Window-pane lighting — refreshed via refreshBuildingMaterial() from WINDOW_LIGHTING store.
uniform float uWindowUnlitLightnessDelta;
uniform float uWindowGapBaseThreshold;
uniform float uWindowGapAgeBonus;
uniform vec3 uDimGlowColor;
// Exponent applied to (1.0 - vModifiedAge) for the lit-window
// count + emission curve. 1.0 = linear; >1.0 dims mid-age faster.
uniform float uLitFreshnessExponent;

varying vec3 vWorldPos; // world-space position for height fog

// ---------------------------------------------------------------------------
// Facade geometry — driven by FACADE_GEOMETRY store via uniforms
// (uSlabHeightFrac / uWindowWidthFrac / uWindowHeightFrac / uWindowMarginFrac
// / uDoorHeightFrac / uRoofBorderFrac, declared above).
//
// Reference values (defaults):
//   uSlabHeightFrac    = 0.12     — slab strip height as fraction of one floor.
//   uWindowWidthFrac   = 0.45     — window width as fraction of one cell.
//                                   Window is centered horizontally within the cell:
//                                     winLeft  = 0.5 - uWindowWidthFrac / 2 = 0.275
//                                     winRight = 0.5 + uWindowWidthFrac / 2 = 0.725
//   uWindowHeightFrac  = 0.45     — window height as fraction of one floor.
//                                   Window is centered vertically in the non-slab portion of the floor.
//                                   The non-slab span in cellV is [0, 1 - uSlabHeightFrac].
//                                   Window center in cellV: uSlabHeightFrac + (1 - uSlabHeightFrac) * 0.5
//                                                         = 0.12 + 0.44 = 0.56
//                                     winBottom = 0.56 - uWindowHeightFrac / 2 = 0.335
//                                     winTop    = 0.56 + uWindowHeightFrac / 2 = 0.785
//   uWindowMarginFrac  = 0.08     — horizontal margin as fraction of face
//                                   width, applied on both edges before dividing into columns.
//                                   The window-column grid spans
//                                   [uWindowMarginFrac, 1 - uWindowMarginFrac] of face width,
//                                   not [0, 1]. Mirrors engine.ts: marginX = floor(width * 0.08),
//                                   then cellW = (width - 2*marginX) / cols.
//   uDoorHeightFrac    = 0.7      — door height as fraction of one floor.
//   uRoofBorderFrac    = 0.03125  — roof border: engine.ts uses strokeRect(2, 2, 124, 124)
//                                   with lineWidth=4 on a 128×128 canvas. Outer edge of the
//                                   stroke is at 4px from canvas edge: 4 / 128 = 0.03125.
// ---------------------------------------------------------------------------

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
// Sun direction, ambient, and sun-contrast are now driven by the
// LIGHTING store (uSunDirWorld / uAmbient / uSunContrast above).

// Slabs (the strip at the top of each floor) sit slightly darker than
// the wall, regardless of light direction, so the floor seams read.
// Driven by uSlabLightnessDelta (FACADE_DETAIL store).

// Lit windows are treated as EMISSIVE — they bypass the directional
// lighting multiplier and push the base color close to white in HSL
// space so they glow like neon panes on the shadow side too.
// Dim failing-fluorescent — a rare lit window in a derelict block.
// Mid-age and newer buildings' lit windows take the building's own
// age-adjusted color (no saturation override), not a fixed target.
// Driven by uDimGlowColor (WINDOW_LIGHTING.DIM_GLOW_COLOR).

// HDR emission boost applied to lit windows, on top of a baseline 1.0
// multiplier. The shader writes into a HalfFloat render target (see
// postFx.ts) so values > 1.0 are preserved; the bloom pass picks them
// up and the OutputPass + ACES tonemapping compresses everything back
// to display range.
//
//   emission = 1.0 + recencyCurve * uWindowEmissionBoost
//   recencyCurve = pow(1.0 - vModifiedAge, uLitFreshnessExponent)
//
// 0 = no HDR push (windows stay LDR, no bloom contribution from windows);
// higher = most-recently-modified building's windows push deeper into
// HDR space and bloom proportionally harder. The recencyCurve preserves
// the age-driven bloom gradient regardless of the boost magnitude.
uniform float uWindowEmissionBoost;
// Dimmer brightness applied to "unlit" windows in the same cell — picked
// per cell by a hash so each building has its own scatter of lit /
// unlit windows. Still positive so the window pane reads as a pane
// (not just blank wall). Driven by uWindowUnlitLightnessDelta
// (WINDOW_LIGHTING store).
// Baseline fraction of cells (per face) that have no window at all —
// irregular gaps so the facade reads as varied instead of a perfect
// grid. Old / dim buildings boost this further so they look boarded-up
// (see renderWallFace). Driven by uWindowGapBaseThreshold and
// uWindowGapAgeBonus (WINDOW_LIGHTING store).
// (The lit-vs-unlit threshold is computed per-fragment from the
// building's brightness rather than being a fixed constant — see
// renderWallFace for the formula.)
// Door lightness delta is driven by uDoorLightnessDelta (FACADE_DETAIL store).

// ---------------------------------------------------------------------------
// Face helpers
// ---------------------------------------------------------------------------

bool isDoorFace() {
  // vOrient: 0=S(+Z=face4), 1=N(-Z=face5), 2=E(+X=face0), 3=W(-X=face1)
  if (vOrient < 0.5) return vFace == FACE_SOUTH;
  if (vOrient < 1.5) return vFace == FACE_NORTH;
  if (vOrient < 2.5) return vFace == FACE_EAST;
  return vFace == FACE_WEST;
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

// hash21 comes from the shared chunk — deterministic per (col, row, seed)
// so a given building's window pattern is stable across frames and
// across the dual-mesh detail / silhouette swap.
#include <hash_glsl_inline>

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
  float lambert = max(dot(normalize(vWorldNormal), uSunDirWorld), 0.0);
  float lightFactor = uAmbient + uSunContrast * lambert;

  vec3 wallColor = baseColor * lightFactor;
  vec3 slabColor = shadeColor(baseColor, uSlabLightnessDelta) * lightFactor;

  // Empty file: a flat slab, so its sliver of wall stays plain — no window,
  // door, seam, or grime math on a face that's a fraction of a floor tall.
  if (vKind == KIND_EMPTY) {
    return vec4(wallColor, vOpacity);
  }

  // Data building: sealed, windowless facade with faint warehouse seams (the
  // fingerprint layers on via the overlay panels). Branch early so no window math runs.
  if (vKind == KIND_DATA) {
    float seam = smoothstep(0.96, 1.0, fract(vUv.y * max(vFloors, 1.0)));
    vec3 sealed = mix(wallColor, slabColor, seam * 0.6);
    return vec4(sealed, vOpacity);
  }

  // Door stays a dark rectangle — small ambient response so it's not pitch-black
  // on sun-side walls but still reads as "open doorway".
  vec3 doorColor = shadeAndShiftHue(baseColor, uDoorLightnessDelta, 0.0, -1.0) * (uAmbient + uSunContrast * lambert * 0.4);
  // winColor is picked per-cell below — each cell hashes to "lit" or
  // "unlit" so the facade doesn't read as a copy-paste grid.

  // vCols.x = cols_ew (for ±X faces), vCols.y = cols_ns (for ±Z faces).
  float cols = isEastWest() ? vCols.x : vCols.y;

  // UV: (0,0) = bottom-left of face, (1,1) = top-right.
  vec2 uv = vUv;

  // Rescale x-UV to exclude the face-level horizontal margin on each edge.
  // The window-column grid occupies [uWindowMarginFrac, 1-uWindowMarginFrac]
  // of face width, matching engine.ts: marginX = floor(width * 0.08),
  // cellW = (width - 2*marginX) / cols, cellCenterX = marginX + cellW*(c+0.5).
  float uvEffX = (uv.x - uWindowMarginFrac) / (1.0 - 2.0 * uWindowMarginFrac);

  // Cell coordinates: integer cell index + intra-cell UV in [0,1].
  float colF   = uvEffX * cols;
  float colIdx = floor(colF);
  float cellU  = fract(colF);
  float rowF   = uv.y * vFloors;
  float row    = floor(rowF); // integer-valued floor index (also feeds the cell hash)
  bool onGroundFloor = row < 0.5; // == row 0, where the door lives
  float cellV  = fract(rowF);

  // Screen-space derivatives for AA. Computed from the CONTINUOUS coords
  // (colF, rowF) before fract — fwidth(fract(x)) blows up at integer
  // boundaries (the 2×2 quad sees fract jump from ~1 to 0, fwidth → 1)
  // which would smear the smoothstep across whole cells.
  float wU = fwidth(colF) * 0.5;
  float wV = fwidth(rowF) * 0.5;

  // Window rectangle within each cell, centered horizontally and
  // vertically above the slab band. Matches uWindowWidthFrac /
  // uWindowHeightFrac usage in _buildFacadeTexture.
  float halfW    = uWindowWidthFrac * 0.5;
  float winLeft  = 0.5 - halfW;
  float winRight = 0.5 + halfW;

  float nonSlabH  = 1.0 - uSlabHeightFrac;
  float winCenter = uSlabHeightFrac + nonSlabH * 0.5; // center in non-slab span
  float halfH     = uWindowHeightFrac * 0.5;
  float winBottom = winCenter - halfH;
  float winTop    = winCenter + halfH;

  // Gate winMask to zero in the horizontal margin strips (uvEffX outside [0,1])
  // so the margin areas show plain wall color, matching the JS canvas output.
  float inMargin = step(0.0, uvEffX) * step(uvEffX, 1.0);
  // Suppress windows on the bottom floor of the door face — the door takes
  // that whole row, and otherwise the door rectangle clips into the windows
  // (door is 0.7 of one floor tall, window center sits at 0.56 of one floor
  // → vertical overlap regardless of horizontal position).
  float bottomDoorRow = (isDoorFace() && onGroundFloor) ? 0.0 : 1.0;
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
  // Two age axes drive window appearance, each per-instance:
  //   vModifiedAge ∈ [0, 1] — staleness on the modified-date axis.
  //     0 = most recently touched in the repo; 1 = longest-untouched.
  //     Drives window count + HDR emission (recencyCurve below).
  //   vIconUV.w   ∈ [0, 1] — file's intrinsic age (creation-date axis).
  //     0 = newest file; 1 = oldest. Drives lit-window glow color
  //     (warm-amber failing-fluorescent ↔ saturated neon), to match
  //     the same axis grime + tilt sit on.
  //
  // Gap density: old-modified buildings show more boarded-up cells.
  float ageGapThreshold = uWindowGapBaseThreshold + vModifiedAge * uWindowGapAgeBonus;
  float gapMask = step(ageGapThreshold, gapHash);
  float winMask  = aaband(winLeft, winRight, cellU, wU) * aaband(winBottom, winTop, cellV, wV) * inMargin * bottomDoorRow * gapMask;

  // Shared recency curve: feeds both lit-window count AND per-lit-window
  // emission. exponent=1.0 gives the linear behavior the codebase had
  // before this change; >1.0 makes mid-age buildings dim out faster
  // (their lit-window count AND each lit window's brightness both drop).
  // recency=1.0 at most recently modified, 0.0 at most stale.
  //
  // The max(..., 1e-6) on the base is a NaN guard: pow(0, x) is undefined
  // in GLSL (spec says "result is undefined if x == 0 and y <= 0"; some
  // drivers extend that to "undefined for x == 0 with any y" because they
  // implement pow as exp(y*log(x)) and log(0) is -Inf). When
  // vModifiedAge = 1 (the oldest file), `1.0 - vModifiedAge` is exactly 0
  // and the unguarded form produced NaN on Apple-silicon Chrome — the NaN
  // then flowed through `emission` and into `gl_FragColor`, contaminating
  // the HDR target.
  float recencyCurve = pow(max(1.0 - vModifiedAge, 1e-6), uLitFreshnessExponent);

  float litThreshold = 1.0 - recencyCurve;
  float litFactor = step(litThreshold, litHash);

  // Lit window glow color: track CREATED age (vIconUV.w), not modifiedAge.
  // A long-existing file's lit windows glow warm amber ("failing
  // fluorescent tube"), regardless of how recently it was edited.
  // Same axis as grime + tilt, so old-existing buildings read coherently
  // even when they're being actively worked on.
  vec3 winNeon = baseColor;
  vec3 winLitColor = mix(uDimGlowColor, winNeon, 1.0 - vIconUV.w);

  // HDR emission scales with the recency curve so recently-modified
  // buildings push their lit windows above 1.0 in the HalfFloat target
  // and the bloom pass picks them up. Mid-age plummets quickly when
  // uLitFreshnessExponent > 1.
  float emission = 1.0 + recencyCurve * uWindowEmissionBoost;
  winLitColor *= emission;
  vec3 winUnlitColor = shadeColor(baseColor, uWindowUnlitLightnessDelta) * lightFactor;
  vec3 winColor = mix(winUnlitColor, winLitColor, litFactor);

  // Slab strip at the top of each floor (cellV approaching 1.0).
  float slabMask = aastep(1.0 - uSlabHeightFrac, cellV, wV);

  // Compose: slab overrides wall; window overrides slab+wall.
  vec3 wallOut  = mix(wallColor, slabColor, slabMask);

  // Procedural grime streaks. Vertical bands of darkened wall color
  // running from the top of each face down — looks like rain stains
  // / soot accumulation on aged concrete. Gated by vIconUV.w
  // (createdAge, repo-relative): old files weather regardless of
  // whether they were edited recently, so a bright recently-modified
  // building can still be heavily streaked if it was first created
  // long ago. Applied to wallOut BEFORE windows compose so windows
  // remain crisp over the dirty facade.
  //
  // Mechanism:
  //   - 25 vertical bands per face (coarse enough to read as streaks,
  //     fine enough to look like running stains, not painted lines).
  //   - Each band's intensity is hash-driven so the streak pattern
  //     is stable per-building per-face.
  //   - threshold drops with age: clean buildings need a very high
  //     hash to produce a streak; old buildings let most bands
  //     through, so dirt covers a wider fraction of the facade.
  //   - Vertical falloff: darkest at the top (where dirt accumulates
  //     and rain runoff originates), fading downward.
  // Intensity + coverage lerp across their [newest, oldest] ranges by this
  // building's createdAge (vIconUV.w), so age maps onto the user's range.
  float gIntensity = mix(uGrimeIntensity.x, uGrimeIntensity.y, vIconUV.w);
  float gCoverage = mix(uGrimeCoverage.x, uGrimeCoverage.y, vIconUV.w);
  if (gIntensity > 0.001) {
    float gBand = floor(uv.x * 25.0);
    float gHash = hash21(vec2(gBand, buildingSeed * 1.7));
    // Coverage threshold: a (gCoverage) fraction of bands streak — a band
    // needs hash >= (1 - gCoverage) to pass.
    float gThreshold = 1.0 - gCoverage;
    float gActive = step(gThreshold, gHash);
    // max(uv.y, 1e-6): same pow(0, x) NaN guard as recencyCurve above.
    float gVert = pow(max(uv.y, 1e-6), 1.6);
    float gFactor = gActive * gVert * (0.6 + 0.4 * gHash);
    vec3 gColor = baseColor * 0.25;
    wallOut = mix(wallOut, gColor, gFactor * gIntensity);
  }

  vec3 withWin  = mix(wallOut, winColor, winMask);

  // Door: ground floor of the door face only. Replaces windows for that row.
  // Only Normal buildings get a door; ruin/future/data facades are blank.
  if (isDoorFace() && onGroundFloor && vKind == KIND_NORMAL) {
    // Door world-width / face world-width = door UV width.
    // vScale = (w, h, d) recovered from instance matrix columns.
    // ±X faces span depth d (vScale.z); ±Z faces span width w (vScale.x).
    // max(..., 1e-6) guards against a degenerate zero-scale building (which
    // would also produce a NaN normal in the vertex shader — see the guard
    // there); without it, this division would be Inf and propagate through.
    float faceWorldWidth = max(isEastWest() ? vScale.z : vScale.x, 1e-6);
    float doorUvWidth  = vDoorWidth / faceWorldWidth;
    float doorLeft     = 0.5 - doorUvWidth * 0.5;
    float doorRight    = 0.5 + doorUvWidth * 0.5;
    float doorTopV     = uDoorHeightFrac / vFloors; // fraction of total face height
    float doorMask = aaband(doorLeft, doorRight, uv.x, fwidth(uv.x) * 0.5)
                   * aaband(0.0, doorTopV, uv.y, fwidth(uv.y) * 0.5);
    withWin = mix(withWin, doorColor, doorMask);
  }

  // withWin is already in sRGB — write directly to the sRGB framebuffer.
  return vec4(withWin, vOpacity);
}

vec4 renderRoofFace() {
  // Flat roof color with a border strip along all four edges.
  // Mirrors engine.ts _buildRoofTexture: strokeRect(2, 2, 124, 124) with
  // lineWidth=4 on a 128×128 canvas → border fraction ≈ 4/128 = 0.03125.
  //
  // Convert linear→sRGB for HSL math, write sRGB result directly to framebuffer
  // (ShaderMaterial has no automatic linearToOutputTexel pass).
  vec3 baseColor   = linearToSrgb(vColor);
  vec3 roofColor   = baseColor;
  // Un-aged reference: the gap to the faded walls is the aging.
  vec3 borderColor = linearToSrgb(vRefColor);
  float innerMask  = aaband(uRoofBorderFrac, 1.0 - uRoofBorderFrac, vUv.x, fwidth(vUv.x) * 0.5)
                   * aaband(uRoofBorderFrac, 1.0 - uRoofBorderFrac, vUv.y, fwidth(vUv.y) * 0.5);
  float borderMask = 1.0 - innerMask;
  vec3 composed = mix(roofColor, borderColor, borderMask);

  // File-type icon overlay. Skip when this instance has no atlas slot
  // (iIconUV negative) or when the atlas hasn't loaded yet (slotSize 0).
  // The icon fills the inner roof area (the border band stays visible
  // around it); the SVG's own alpha controls how aggressively it
  // overrides the base roof color.
  if (vIconUV.x >= 0.0 && uIconSlotSize > 0.0) {
    // Inset the icon inside the border so it doesn't clip the dark strip.
    float pad = uRoofBorderFrac;
    vec2 inset = clamp((vUv - pad) / (1.0 - 2.0 * pad), 0.0, 1.0);
    // Rotate so the icon's "top" lands at the building's far edge from
    // the door — readable to someone standing in front of the door and
    // looking at the building. Roof UVs are laid out:
    //   uv = (0, 0) = south-west, (1, 0) = south-east,
    //        (0, 1) = north-west, (1, 1) = north-east
    // Icon atlas Y is canvas-native (flipY=false): atlasUv.y=0 is the
    // icon's top edge. atlasUv.x=0 is the icon's left edge — which has
    // to land on the VIEWER's left when they're standing at the door.
    // Per right-hand-rule (forward × up = right), viewer-left depends
    // on which direction the door faces; an early version of this code
    // got the X axis backwards for door=E and door=W, mirroring the
    // text. Each variant pair below sums to (1, 1) — a 180° rotation
    // between opposite door directions.
    vec2 rotated;
    if (vOrient < 0.5)      rotated = vec2(inset.x, 1.0 - inset.y); // door S (faces +Z): viewer-left = west
    else if (vOrient < 1.5) rotated = vec2(1.0 - inset.x, inset.y); // door N (faces -Z): viewer-left = east
    else if (vOrient < 2.5) rotated = vec2(inset.y, inset.x);       // door E (faces +X): viewer-left = south
    else                    rotated = vec2(1.0 - inset.y, 1.0 - inset.x); // door W (faces -X): viewer-left = north
    vec2 atlasUv = vIconUV.xy + rotated * uIconSlotSize;
    vec4 icon = texture2D(uIconAtlas, atlasUv);
    // Composite over the roof: icon.rgb on top, alpha-weighted.
    composed = mix(composed, icon.rgb, icon.a * innerMask);
  }

  // Deleted-file cross, over the icon so the file type stays readable under it.
  if (vKind == KIND_RUIN && uRuinXEnabled) {
    vec2 inner = (vUv - uRoofBorderFrac) / (1.0 - 2.0 * uRoofBorderFrac);
    // Distance to the inner square's two diagonals, sqrt(2)x the perpendicular
    // one, so RUIN_X_DIAG converts uRuinXWidth into this space.
    float d = min(abs(inner.x - inner.y), abs(inner.x + inner.y - 1.0));
    float halfW = uRuinXWidth * RUIN_X_DIAG;
    float aa = max(fwidth(d), 1e-6);
    float stroke = 1.0 - smoothstep(halfW - aa, halfW + aa, d);
    composed = mix(composed, uRuinXColor, stroke * innerMask);
  }

  return vec4(composed, vOpacity);
}

vec4 renderBottomFace() {
  // Bottom face is rarely visible; it points straight down so the sun's
  // lambert term goes to zero and we render at pure ambient.
  vec3 baseColor = linearToSrgb(vColor);
  return vec4(baseColor * uAmbient, vOpacity);
}

// Silhouette mode: render the proper face-shaded base color but skip
// per-cell window/door/slab/roof-border math. Walls and bottom use the
// same directional-light formula as the detail tier so a silhouette
// building reads consistently when the camera transitions between LODs.
vec4 renderSilhouette() {
  vec3 baseColor = linearToSrgb(vColor);
  if (vFace == FACE_ROOF) {
    // Roof — solid base color, no directional shading (matches detail tier).
    return vec4(baseColor, vOpacity);
  }
  float lambert = max(dot(normalize(vWorldNormal), uSunDirWorld), 0.0);
  float lightFactor = uAmbient + uSunContrast * lambert;
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
  // Ghost-ruin: keep all four walls AND a roof (not a hollow open-top shell),
  // but punch sparse "missing brick" holes into the walls plus a jagged top-rim
  // nibble so it reads as broken. Roof + bottom stay solid; future slab excluded.
  if (vKind == KIND_RUIN && isWallFace()) {
    float seed = float(vFace) * RUIN_FACE_SEED;
    if (hash21(floor(vUv * RUIN_BRICK_CELLS) + seed) < RUIN_HOLE_CHANCE) discard; // missing bricks
    float rim = RUIN_RIM_MIN + RUIN_RIM_JITTER * hash21(vec2(floor(vUv.x * RUIN_RIM_CELLS), seed));
    if (vUv.y > rim) discard; // jagged top edge under the roof line
  }

  vec4 body;
  if (vSilhouette > 0.5)      body = renderSilhouette();
  else if (vFace == FACE_ROOF)        body = renderRoofFace();
  else if (vFace == FACE_BOTTOM)        body = renderBottomFace();
  else                        body = renderWallFace();
  vec4 outColor = compositeOutline(body);

  // Ruin facade: coarse grime so the blank stub looks weathered, not painted. Ruins only, not the future slab.
  if (vKind == KIND_RUIN) outColor.rgb *= RUIN_GRIME_FLOOR + RUIN_GRIME_RANGE * hash21(floor(vUv * RUIN_GRIME_CELLS));

  // Buildings sit on the ground (base y = 0), so vScale.y normalizes worldPos.y
  // straight into height-within-this-building.
  outColor.rgb = applyFog(outColor.rgb, vWorldPos, vScale.y);

  gl_FragColor = outColor;
}

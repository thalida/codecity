// defaults.js — Single source of truth for every visual / layout knob the
// renderer reads. Each tunable group is its own named export so consumers
// can import only what they need; the in-app Settings panel mutates these
// objects in place at runtime.
//
// Three categories of knob live in here:
//
//   1. LAYOUT  — affects street/building positions. Changes need a full
//                re-layout (rebuild) before they take visible effect.
//
//   2. BUILDING — facade dimensions + palette. Changes need every building's
//                CanvasTexture regenerated (rebuild meshes, no re-layout).
//
//   3. SCENE — colors, opacities, line widths, animation tuning. Most of
//              this group is HOT-RELOADABLE: the render loop reads the
//              values fresh each frame, so the Settings UI can mutate
//              them in place. Exceptions are flagged inline.


// ─── LAYOUT ─────────────────────────────────────────────────────────────────
// Distances between things on the street network. Changing any of these
// shifts every street + building, so the scene must be re-laid-out and
// re-built. NOT hot-reloadable.
export const LAYOUT = {
  // Gap between sibling children (file or subdir) on the same street.
  child_gap: 5,
  // Strip between a building's wall and the adjacent street's sidewalk.
  bldg_street_gap: 4,
  // Width of the connector strip that bridges that gap (the "path"
  // mesh). Must be ≤ bldg_street_gap.
  path_width: 3,
  // Step-function mapping descendant count → street width. The first
  // matching tier from the top wins. Wider streets read as more
  // important directories from the air.
  street_tiers: [
    { min_descendants: 0, width: 10 },
    { min_descendants: 4, width: 16 },
    { min_descendants: 9, width: 24 },
    { min_descendants: 16, width: 36 },
    { min_descendants: 31, width: 52 }
  ]
};


// ─── BUILDING ───────────────────────────────────────────────────────────────
// How big each building is and what color its facade is. Floor count is
// sqrt-normalized across the project's own min/max line counts (so the
// smallest file lands at min_floors, largest at max_floors). Width is
// log-normalized against size_ceiling_bytes. Changing any of these
// requires regenerating per-building facade textures.
export const BUILDING = {
  // One floor per N source lines. Smaller value → taller buildings.
  lines_per_floor: 20,
  // Floor count is clamped to [min_floors, max_floors] so a 100k-line
  // file doesn't dwarf the rest of the city.
  min_floors: 1,
  max_floors: 50,
  // Visual height of a single floor in scene units. The whole tower
  // is `floors × floor_height` tall.
  floor_height: 10,
  // File size at which width caps at max_width. Files smaller than
  // this scale logarithmically toward min_width.
  size_ceiling_bytes: 10485760,        // 10 MB
  min_width: 6,
  max_width: 40,
  // HSL bands used when computing each building's facade color. Hue
  // comes from hue_ext_map keyed by file extension; saturation +
  // lightness pull from these ranges based on file age (older = more
  // muted) and recency (newer = brighter).
  saturation: { min: 20, max: 100 },
  lightness: { min: 25, max: 70 },
  // Extension → hue (0–360 on the color wheel). Add new extensions
  // here to give them their own family color.
  hue_ext_map: {
    '.js': 220, '.ts': 215, '.jsx': 225, '.tsx': 210, '.mjs': 220,
    '.py': 15, '.pyx': 20, '.pyi': 10,
    '.css': 150, '.scss': 145, '.less': 155, '.sass': 148,
    '.html': 175, '.vue': 170, '.svelte': 180,
    '.json': 50, '.yaml': 55, '.toml': 45, '.ini': 52,
    '.md': 275, '.txt': 280, '.rst': 270,
    '.sh': 35, '.bash': 38, '.zsh': 32,
    '.go': 185, '.rs': 5
  }
};


// ─── SCENE: BACKGROUND COLORS ───────────────────────────────────────────────
// Sky / void color behind everything. Hot-reloadable.
export const GROUND_COLOR = '#0a0b10';
// The dark center stripe of every street. Hot-reloadable.
export const ASPHALT_COLOR = '#1a1d28';


// ─── SCENE: SIDEWALK TINTS ──────────────────────────────────────────────────
// Default is the resting tint; the rest are state-driven recolors driven by
// hover / select / path-lineage. All hot-reloadable.
export const SIDEWALK_COLORS = {
  default: '#2c2e36',
  hover: '#d0d2da',
  selected: '#ffffff',
  path: '#4a4c54'         // ancestor streets along selection lineage
};


// ─── SCENE: ROAD-NAME LABELS ────────────────────────────────────────────────
// NOT hot-reloadable: these are baked into a CanvasTexture per street and
// would need every label texture regenerated to take effect.
export const LABEL_COLORS = {
  fill: '#f4f6ff',
  stroke: 'rgba(8, 9, 14, 0.95)'
};


// ─── SCENE: BUILDING OUTLINES ───────────────────────────────────────────────
// Wireframe outlines drawn around buildings. Per-building default outlines
// stay invisible until the building fades; hover + selected outlines are
// dedicated overlays painted over the active building. Hot-reloadable.
export const OUTLINE = {
  default_linewidth: 3,
  hover_color: '#ffffff',
  hover_linewidth: 2,
  selected_linewidth: 4
};


// ─── SCENE: VISIBILITY TIER FADE ────────────────────────────────────────────
// When a street/building is selected or hovered, every other building gets
// dimmed based on its directory-tree distance from the selection. All values
// are read fresh per frame, so they're hot-reloadable.
export const FADE = {
  // Per-frame easing factor for opacity transitions. Higher = snappier,
  // lower = smoother.
  lerp_speed: 0.18,
  // Crossfade band between the textured (windowed) building mesh and the
  // windowless ghost body. Above fade_top only the textured mesh shows;
  // below fade_bottom only the ghost shows. fade_bottom must stay above
  // tier_near.body so faded tiers never reveal windows.
  fade_top: 1.0,
  fade_bottom: 0.7,
  // Tier values for "1 hop along the selection's spine" buildings.
  // body = main mesh opacity (drives ghost); outline = wireframe dim
  // multiplier; ghost = solid-color body dim multiplier.
  tier_near: { body: 0.65, outline: 0.40, ghost: 0.85 },
  // Tier values for everything farther than 1 hop. Effectively the
  // outline-only "distant" presentation.
  tier_far: { body: 0.18, outline: 0.12, ghost: 0.20 }
};


// ─── SCENE: HOVER STICKINESS ────────────────────────────────────────────────
// Milliseconds the cursor must stay on a target before its hover cascade
// commits. Throttles flicker when sweeping across the scene. Hot-reloadable.
export const HOVER_COMMIT_MS = 40;


// ─── SCENE: ROOT GEM ────────────────────────────────────────────────────────
// The floating root-of-repo gem at the start of the root street. Sizing
// knobs (radius_*, building_clearance) require a re-layout since the layout
// reserves dead space around the gem; runtime knobs (hover_lift_frac,
// bob_amplitude_frac, edge_color) are hot-reloadable.
export const ROOT_GEM = {
  // Gem radius = streetWidth × this fraction.
  radius_as_street_frac: 0.35,
  // Lower bound on the gem's radius so very narrow root streets still
  // get a visible gem.
  min_radius: 5,
  // The gem hovers above the sidewalk at this fraction of its own
  // radius.
  hover_lift_frac: 0.3,
  // Vertical bob amplitude as a fraction of the gem's radius.
  bob_amplitude_frac: 0.5,
  // Layout reserves this much extra space (in scene units) past the
  // gem before placing the first building, so the gem has breathing
  // room.
  building_clearance: 20,
  // Edge / wireframe color drawn around the gem's faces.
  edge_color: '#f0f0ff'
};


// Composed config object matching the shape that layoutCity / buildCityScene
// already accept (`config.layout`, `config.building`, `config.scene.*`). Lets
// existing function signatures stay untouched while individual constants
// stay independently importable + mutable for the Settings UI.
export const DEFAULTS_CONFIG = {
  layout: LAYOUT,
  building: BUILDING,
  scene: {
    ground: GROUND_COLOR,
    asphalt: ASPHALT_COLOR,
    sidewalk: SIDEWALK_COLORS,
    label: LABEL_COLORS,
    outline: OUTLINE,
    fade: FADE,
    hover_commit_ms: HOVER_COMMIT_MS,
    root_gem: ROOT_GEM
  }
};

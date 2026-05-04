// constants.js — Enum-like string values used as comparisons / discriminants
// throughout the renderer. Kept separate from config/ because these aren't
// designer-tunable — they're identifiers the code matches against.

// Single shared vocabulary for ALL "what kind of thing is this?" decisions:
//   - the scanner stamps each node as FILE or DIRECTORY
//   - the engine stamps mesh.userData.type with the matching kind so picking
//     can dispatch directly off the visual representation
//   - main.js stores currentSelection.kind / currentHover.kind using the
//     same values so engine + selection state speak the same language
//
// FILE      — a file in the manifest; rendered as a building mesh
// DIRECTORY — a directory in the manifest; rendered as a street group
// GEM       — the floating root-of-repo landmark (not a manifest node, but
//             pickable + selectable so it shares this enum)
// LABEL     — a road-name plane (presentational, not selectable; stamped so
//             raycaster filters can recognize it)
export const NODE_KIND = Object.freeze({
  FILE:      'file',
  DIRECTORY: 'directory',
  GEM:       'gem',
  LABEL:     'label'
});

// Building door-facing direction. Layout sets this; engine reads it to know
// which face holds the door.
export const BUILDING_ORIENT = Object.freeze({
  NORTH: 'n',
  SOUTH: 's',
  EAST:  'e',
  WEST:  'w'
});

// Street long-axis. 'x' = street runs along world-X, 'y' = along world-Z.
export const STREET_AXIS = Object.freeze({
  X: 'x',
  Y: 'y'
});

// Top-level DOM element IDs the renderer + components target.
export const DOM_IDS = Object.freeze({
  CANVAS:        'city',
  TREE_SIDEBAR:  'tree-sidebar',
  FILE_SIDEBAR:  'sidebar',
  HOVER_TOOLTIP: 'hover-tooltip'
});

// Left-sidebar tab IDs.
export const SIDEBAR_TAB = Object.freeze({
  TREE:     'tree',
  INFO:     'info',
  CONTROLS: 'controls'
});

// Lucide icon CDN base. Tree glyphs, activity-bar tabs, and the sidebar
// close button all reference per-icon SVG filenames relative to this URL.
export const LUCIDE_ICON_BASE_URL =
  'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/';

// Activity-bar tab definitions (left-side icon strip). Each entry maps a
// tab id to the Lucide icon filename + the tooltip title. Not designer-
// tunable — these are part of the app's structural definition.
export const ACTIVITY_BAR_TABS = Object.freeze([
  { id: 'tree',     icon: 'folder-tree.svg',        title: 'Tree'     },
  { id: 'info',     icon: 'info.svg',               title: 'Info'     },
  { id: 'controls', icon: 'sliders-horizontal.svg', title: 'Controls' }
]);

// Renderer Z-order plumbing: which surface wins when two coplanar / overlapping
// transparent meshes overlap. Lower values draw first, higher values draw on
// top. Tweaking values risks z-fighting; treat as an implementation detail.
export const RENDER_ORDERS = Object.freeze({
  SIDEWALK:         1,        // baseline ground layer
  PATH_CONNECTOR:   2,        // building→street walkways
  ASPHALT:          3,        // street stripe (drawn over sidewalks)
  PATH_LINE:        4,        // neon gem→selection line
  HOVER_OUTLINE:    5,        // building hover wireframe
  BUILDING_OUTLINE: 5,        // per-building default wireframe
  STREET_LABEL:     6,        // baked road-name plane
  SELECTED_OUTLINE: 7         // chasing-rainbow selected wireframe
});

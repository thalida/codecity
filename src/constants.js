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
  CANVAS:            'city',
  TREE_SIDEBAR:      'tree-sidebar',
  FILE_SIDEBAR:      'sidebar',
  EMBEDDED_MANIFEST: 'codecity-manifest',
  HOVER_TOOLTIP:     'hover-tooltip'
});

// Left-sidebar tab IDs.
export const SIDEBAR_TAB = Object.freeze({
  TREE:     'tree',
  CONTROLS: 'controls'
});

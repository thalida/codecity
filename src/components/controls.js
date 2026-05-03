// controls.js — "Controls" tab in the left sidebar.
//
// Layout:
//   .controls-pane (flex column)
//     .controls-header   — title
//     .controls-body     — scrollable column of sections (one per scene element)
//     .controls-actions  — sticky bottom bar: "Reload" + "Reset all"
//
// Per-row affordances:
//   ↻ rebuild badge — appears next to labels for rebuild-required knobs
//   reset icon      — appears in the row's control area ONLY when the
//                     value differs from its default; click resets that
//                     key (and removes its localStorage entry)
//
// Why one section per scene element instead of Theme/Advanced split?
// Because the user thinks "I want to change something about street labels",
// not "I want to change a hot-reloadable thing."

import {
  // Background
  SCENE_COLORS,
  // Streets
  ASPHALT, SIDEWALK_COLORS, LABEL_TYPOGRAPHY, PATH_LINE, HOVER_PATH_LINE, STREET_LAYOUT,
  // Buildings
  BUILDING_DIMENSIONS, BUILDING_PALETTE, BUILDING_OUTLINE, BUILDING_FADE,
  // Gem
  GEM_SIZING, GEM_APPEARANCE, GEM_ANIMATION,
  // Effects
  RAINBOW
} from '../config/index.js';
import {
  clearPersistence, getDefault, resetKey, hasAnyOverrides, onAnyChange
} from '../config/_persist.js';
import { makeLucideIcon } from './icon.js';

// buildControlsPane(opts) -> HTMLElement
//
// opts:
//   applyTheme — fn() invoked after any hot-reloadable mutation; flushes
//                the change through to live materials. Optional.
//   onClose    — fn() invoked when the user clicks the × in the header.
//                Optional; if omitted, no close button is rendered.
//
// (onResetView is no longer used — the View section shows a kbd shortcut
// table including R, which the existing keydown handler in main.js wires
// to resetView. The "Reset camera" button is gone.)
export function buildControlsPane(opts) {
  opts = opts || {};
  var applyTheme = opts.applyTheme || function () {};

  var pane = document.createElement('div');
  pane.className = 'left-pane controls-pane';

  var header = document.createElement('div');
  header.className = 'controls-header pane-header';
  var title = document.createElement('h3');
  title.className = 'controls-title';
  title.textContent = 'Controls';
  header.appendChild(title);
  if (typeof opts.onClose === 'function') {
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pane-header-close';
    closeBtn.title = 'Hide sidebar';
    closeBtn.setAttribute('aria-label', 'Hide sidebar');
    closeBtn.appendChild(makeLucideIcon('x'));
    closeBtn.addEventListener('click', function () { opts.onClose(); });
    header.appendChild(closeBtn);
  }
  pane.appendChild(header);

  var body = document.createElement('div');
  body.className = 'controls-body';

  // Sections are organized by what the user is *looking at* (background,
  // streets, buildings, gem) plus shared visual effects. Camera lens /
  // orbit / animation timings and input-feel knobs (hover commit, click
  // thresholds, tooltip placement) intentionally aren't surfaced — they're
  // designer-level constants that already have natural in-scene controls
  // (mouse to orbit, kbd to reset). See View > shortcuts list.
  body.appendChild(_buildViewSection());
  body.appendChild(_buildBackgroundSection(applyTheme));
  body.appendChild(_buildStreetsSection(applyTheme));
  body.appendChild(_buildBuildingsSection(applyTheme));
  body.appendChild(_buildGemSection(applyTheme));
  body.appendChild(_buildEffectsSection(applyTheme));

  pane.appendChild(body);
  pane.appendChild(_buildActionsSection());   // sticky bottom — sibling of body
  return pane;
}


// ─── View ──────────────────────────────────────────────────────────────────
// No "Reset camera" button — the R key already covers that, and surfacing
// the full shortcut list as a table makes the rest of the controls
// (orbit / pan / zoom / focus / select) discoverable too.
function _buildViewSection() {
  var section = _section('View',
    'Pivot follows what you point at. The selected building stays solid; everything else fades by directory-tree distance from the selection.');

  section.appendChild(_buildShortcutsList([
    { kbd: ['R'],   action: 'Reset the camera framing' },
    { kbd: ['F'],   action: 'Focus camera on the current selection' },
    { kbd: ['Esc'], action: 'Close the sidebar / clear selection' },
    null,        // section break
    { mouse: 'Left drag',    action: 'Orbit' },
    { mouse: 'Right drag',   action: 'Pan' },
    { mouse: 'Middle drag',  action: 'Dolly (zoom)' },
    { mouse: 'Scroll',       action: 'Zoom toward cursor' },
    null,
    { mouse: 'Click',        action: 'Select building / street / gem' },
    { mouse: 'Double-click', action: 'Focus camera on the target' }
  ]));

  return section;
}

function _buildShortcutsList(items) {
  var dl = document.createElement('dl');
  dl.className = 'shortcuts-list';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item == null) {
      var divider = document.createElement('div');
      divider.className = 'shortcuts-divider';
      dl.appendChild(divider);
      continue;
    }
    var dt = document.createElement('dt');
    if (item.kbd) {
      for (var k = 0; k < item.kbd.length; k++) {
        if (k > 0) dt.appendChild(document.createTextNode(' '));
        var key = document.createElement('kbd');
        key.textContent = item.kbd[k];
        dt.appendChild(key);
      }
      if (item.or) {
        var or = document.createElement('span');
        or.className = 'shortcuts-or';
        or.textContent = ' ' + item.or;
        dt.appendChild(or);
      }
    } else if (item.mouse) {
      var ms = document.createElement('span');
      ms.className = 'shortcuts-mouse';
      ms.textContent = item.mouse;
      dt.appendChild(ms);
    }
    var dd = document.createElement('dd');
    dd.textContent = item.action;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  return dl;
}


// ─── Background ────────────────────────────────────────────────────────────
function _buildBackgroundSection(applyTheme) {
  var section = _section('Background', 'The void behind everything.');
  section.appendChild(_color('Sky / ground', SCENE_COLORS, 'GROUND', {
    tip: 'Color shown behind buildings + streets. Live.',
    onChange: applyTheme
  }));
  return section;
}


// ─── Streets ───────────────────────────────────────────────────────────────
function _buildStreetsSection(applyTheme) {
  var section = _section('Streets',
    'Asphalt, sidewalks, street labels, and the neon path that highlights the route from the root gem to the selected file.');

  // Asphalt — color only. Width is a designer-level geometry knob; length
  // is derived to keep the cap circles concentric.
  section.appendChild(_subgroup('Asphalt', [
    _color('Color', ASPHALT, 'COLOR', {
      tip: 'Color of the inner road stripe. Live.',
      onChange: applyTheme
    })
  ]));

  // Sidewalks. (No "Path" tint — the lineage from gem→selection is shown
  // by the rainbow neon line alone, see "Selection path line" below.)
  section.appendChild(_subgroup('Sidewalk colors', [
    _color('Default',  SIDEWALK_COLORS, 'DEFAULT',  { tip: 'Resting tint on every sidewalk.', onChange: applyTheme }),
    _color('Hover',    SIDEWALK_COLORS, 'HOVER',    { tip: 'When the cursor is over a street.', onChange: applyTheme }),
    _color('Selected', SIDEWALK_COLORS, 'SELECTED', { tip: 'When a street (directory) is selected.', onChange: applyTheme })
  ]));

  // Street labels
  section.appendChild(_subgroup('Street labels', [
    _color ('Fill', LABEL_TYPOGRAPHY, 'FILL', {
      tip: 'Text color of the names painted on each road. Live (label textures regenerate on the fly when this changes).',
      onChange: applyTheme
    }),
    _slider('Camera-flip dead zone', LABEL_TYPOGRAPHY, 'FLIP_HYSTERESIS', 0, 0.5, 0.01, {
      tip: 'How far the camera must rotate before labels flip 180° to stay readable. Higher = less flicker, more time spent reading upside-down.',
      onChange: applyTheme
    }),
    _number('Font size (px)',       LABEL_TYPOGRAPHY, 'FONT_SIZE_PX',      32, 512, 8, {
      tip: 'Source canvas font size. Higher = sharper close-zoom, larger texture memory.',
      rebuild: true
    }),
    _number('Padding (px)',         LABEL_TYPOGRAPHY, 'CANVAS_PADDING_PX', 0, 200, 4, {
      tip: 'Whitespace around each label inside its texture canvas.',
      rebuild: true
    }),
    _number('Stroke width (px)',    LABEL_TYPOGRAPHY, 'STROKE_WIDTH_PX',   0, 100, 1, {
      tip: 'Thickness of the dark outline behind the label fill.',
      rebuild: true
    }),
    _slider('Height × street width', LABEL_TYPOGRAPHY, 'HEIGHT_FRAC', 0, 2, 0.05, {
      tip: 'Label plane height in world units, as a fraction of the street width. Wider streets get bigger labels.',
      onChange: applyTheme
    }),
    _slider('Repeat × label width', LABEL_TYPOGRAPHY, 'SPACING_MULT', 0.5, 10, 0.1, {
      tip: 'Distance between label repeats along a long street, expressed as a multiple of the label width.',
      rebuild: true
    }),
    _number('Repeat floor', LABEL_TYPOGRAPHY, 'SPACING_FLOOR', 0, 1000, 10, {
      tip: 'Minimum repeat distance in world units (so tiny labels do not pile up).',
      rebuild: true
    })
  ]));

  // Selection path line — the neon line tracing gem → current selection
  // through the road network. Color cycle is shared with the building
  // outline; tweak Effects > Rainbow.
  section.appendChild(_subgroup('Selection path line', [
    _number('Linewidth', PATH_LINE, 'LINEWIDTH', 1, 20, 1, {
      tip: 'Pixel thickness of the rainbow line.',
      onChange: applyTheme
    }),
    _slider('Opacity', PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
      tip: 'Path-line transparency. 0 = invisible; 1 = solid.',
      onChange: applyTheme
    })
  ]));

  // Hover preview path line — the faded "what would happen if I clicked"
  // version of the selection line, drawn while the cursor is over a
  // building or street. Suppressed when the hovered target IS the
  // current selection (would just overlap the rainbow line).
  section.appendChild(_subgroup('Hover preview path line', [
    _toggle('Enabled', HOVER_PATH_LINE, 'ENABLED', {
      tip: 'Show a draft preview line from the gem to whatever the cursor is currently over.',
      onChange: applyTheme
    }),
    _color ('Color', HOVER_PATH_LINE, 'COLOR', {
      tip: 'Solid color of the preview line. Faded white by default so it reads as a draft, not the committed rainbow line.',
      onChange: applyTheme
    }),
    _number('Linewidth', HOVER_PATH_LINE, 'LINEWIDTH', 1, 20, 1, {
      tip: 'Pixel thickness of the preview line.',
      onChange: applyTheme
    }),
    _slider('Opacity', HOVER_PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
      tip: 'Preview-line transparency. 0 = invisible; 1 = solid.',
      onChange: applyTheme
    })
  ]));

  // Layout
  section.appendChild(_subgroup('Layout', [
    _number('Sibling gap',         STREET_LAYOUT, 'CHILD_GAP',       0, 50, 1, {
      tip: 'Distance between sibling children (file or subdir) packed along a street.',
      rebuild: true
    }),
    _number('Root end pad',        STREET_LAYOUT, 'ROOT_END_PAD',    0, 50, 1, {
      tip: 'Fallback pad at each end of the root street (which has no parent intersection).',
      rebuild: true
    }),
    _number('Parent join pad',     STREET_LAYOUT, 'PARENT_JOIN_PAD', 0, 20, 1, {
      tip: 'Extra clear space where a child street meets its parent.',
      rebuild: true
    })
  ]));

  return section;
}


// ─── Buildings ─────────────────────────────────────────────────────────────
function _buildBuildingsSection(applyTheme) {
  var section = _section('Buildings',
    'Per-file boxes — height from line count, width from byte size, color from extension + age.');

  section.appendChild(_subgroup('Size', [
    _rangePair('Floors range',  BUILDING_DIMENSIONS, 'MIN_FLOORS', 'MAX_FLOORS', 1, 200, 1, {
      tip: 'How tall a building gets — represents the file\'s line count. Smallest file in the project lands at MIN floors; largest at MAX. Sqrt-interpolated across line counts.',
      rebuild: true
    }),
    _number('Floor height',     BUILDING_DIMENSIONS, 'FLOOR_HEIGHT', 1, 50, 1, {
      tip: 'Vertical world units per floor (multiplier on the floor count above).',
      rebuild: true
    }),
    _rangePair('Width range',   BUILDING_DIMENSIONS, 'MIN_WIDTH', 'MAX_WIDTH', 1, 200, 1, {
      tip: 'How wide a building\'s footprint is — represents the file\'s byte size. Smallest file lands at MIN width; largest at MAX. Log-interpolated across byte sizes. Footprints are square (depth = width).',
      rebuild: true
    }),
    _number('Building path length', BUILDING_DIMENSIONS, 'PATH_LENGTH', 0, 50, 1, {
      tip: 'Distance from the building\'s wall to the adjacent sidewalk. The path connector strip bridges this gap.',
      rebuild: true
    }),
    _slider('Building path width',  BUILDING_DIMENSIONS, 'PATH_WIDTH_FRAC', 0, 1, 0.05, {
      tip: 'Width of the path connector strip, as a fraction of the building\'s own width — so big buildings get proportionally wider paths. Door is sized to ~80% of this same per-building path width.',
      rebuild: true
    })
  ]));

  section.appendChild(_subgroup('Color palette (HSL)', [
    _rangePair('Saturation range', BUILDING_PALETTE, 'SATURATION_MIN', 'SATURATION_MAX', 0, 100, 5, {
      tip: 'HSL saturation range — older files tend to MIN, newly-created tend to MAX.',
      rebuild: true
    }),
    _rangePair('Lightness range',  BUILDING_PALETTE, 'LIGHTNESS_MIN',  'LIGHTNESS_MAX',  0, 100, 5, {
      tip: 'HSL lightness range — recently-modified files tend to MAX (brighter); stale files tend to MIN.',
      rebuild: true
    }),
    _color('Directory color',  BUILDING_PALETTE, 'DIRECTORY_COLOR', {
      tip: 'Solid color for any building representing a directory rather than a file.',
      rebuild: true
    })
  ]));

  // Extension hues — one row per file extension in HUE_EXT_MAP, sorted
  // alphabetically so the list stays predictable. Each row writes back
  // to a single sub-key of HUE_EXT_MAP (no whole-map clobber).
  var huePaletteRows = [];
  var hueDefaults = getDefault(BUILDING_PALETTE, 'HUE_EXT_MAP') || {};
  var hueExtensions = Object.keys(hueDefaults).sort();
  for (var ei = 0; ei < hueExtensions.length; ei++) {
    huePaletteRows.push(_nestedSlider(
      hueExtensions[ei],
      BUILDING_PALETTE, 'HUE_EXT_MAP', hueExtensions[ei],
      0, 359, 1, {
        tip: 'Hue (0–359°) for files with this extension.',
        rebuild: true,
        previewHue: true
      }
    ));
  }
  section.appendChild(_subgroup('Extension hues (0–359°)', huePaletteRows));

  section.appendChild(_subgroup('Outlines', [
    _number('Linewidth',        BUILDING_OUTLINE, 'WIDTH', 1, 10, 1, {
      tip: 'Pixel thickness shared by per-building, hover, and selected outlines.',
      onChange: applyTheme
    }),
    _color ('Hover color',      BUILDING_OUTLINE, 'HOVER_COLOR', {
      tip: 'Outline color when the cursor is over a building.',
      onChange: applyTheme
    }),
    _slider('Hover opacity',    BUILDING_OUTLINE, 'HOVER_OPACITY',    0, 1, 0.05, { onChange: applyTheme }),
    _slider('Selected opacity', BUILDING_OUTLINE, 'SELECTED_OPACITY', 0, 1, 0.05, {
      tip: 'Selected outline uses an animated rainbow color — see Effects > Rainbow.',
      onChange: applyTheme
    })
  ]));

  // Selection fade — animation knobs first, then per-tier style. Each tier
  // (Default = siblings of selection / Level 1 = one hop / Level 2+ = far)
  // gets four controls: detail (full / silhouette / hidden), outline on/off,
  // and separate body + outline opacity sliders. Hover renders a building
  // using the Default tier's settings — no separate hover-floor knob.
  section.appendChild(_subgroup('Selection fade — animation', [
    _slider('Fade speed', BUILDING_FADE, 'LERP_SPEED', 0.01, 1.0, 0.01, {
      tip: 'Per-frame easing toward the target opacity. Higher = snappier transitions.',
      onChange: applyTheme
    })
  ]));

  var DETAIL_OPTIONS = [
    { value: 'full',       label: 'Full' },
    { value: 'silhouette', label: 'Silhouette' },
    { value: 'hidden',     label: 'Hidden' }
  ];

  section.appendChild(_subgroup('Default — siblings of selection', [
    _select('Detail',  BUILDING_FADE, 'DEFAULT_DETAIL', DETAIL_OPTIONS, {
      tip: 'Full = textured walls + windows + doors. Silhouette = solid-color box. Hidden = body invisible (only outline can show).',
      onChange: applyTheme
    }),
    _toggle('Outline', BUILDING_FADE, 'DEFAULT_OUTLINE', {
      tip: 'Show the wireframe edge overlay.',
      onChange: applyTheme
    }),
    _slider('Body opacity',    BUILDING_FADE, 'DEFAULT_BODY_OPACITY',    0.0, 1.0, 0.05, {
      tip: 'Opacity for the body / silhouette layer.',
      onChange: applyTheme
    }),
    _slider('Outline opacity', BUILDING_FADE, 'DEFAULT_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {
      tip: 'Opacity for the wireframe outline layer (only visible if Outline is on).',
      onChange: applyTheme
    })
  ]));

  section.appendChild(_subgroup('Level 1 — one hop from selection', [
    _select('Detail',          BUILDING_FADE, 'NEAR_DETAIL', DETAIL_OPTIONS,         { onChange: applyTheme }),
    _toggle('Outline',         BUILDING_FADE, 'NEAR_OUTLINE',                        { onChange: applyTheme }),
    _slider('Body opacity',    BUILDING_FADE, 'NEAR_BODY_OPACITY',    0.0, 1.0, 0.05, { onChange: applyTheme }),
    _slider('Outline opacity', BUILDING_FADE, 'NEAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, { onChange: applyTheme })
  ]));

  section.appendChild(_subgroup('Level 2+ — cousins, deeper subtrees', [
    _select('Detail',          BUILDING_FADE, 'FAR_DETAIL', DETAIL_OPTIONS,         { onChange: applyTheme }),
    _toggle('Outline',         BUILDING_FADE, 'FAR_OUTLINE',                        { onChange: applyTheme }),
    _slider('Body opacity',    BUILDING_FADE, 'FAR_BODY_OPACITY',    0.0, 1.0, 0.05, { onChange: applyTheme }),
    _slider('Outline opacity', BUILDING_FADE, 'FAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, { onChange: applyTheme })
  ]));

  return section;
}


// ─── Gem ───────────────────────────────────────────────────────────────────
function _buildGemSection(applyTheme) {
  var section = _section('Root gem',
    'The floating spinning octahedron above the root street.');

  section.appendChild(_subgroup('Sizing + plaza', [
    _slider('Radius × street width', GEM_SIZING, 'RADIUS_AS_STREET_FRAC', 0.05, 1, 0.05, {
      tip: 'Gem radius relative to the root street width. Bigger gems demand more empty plaza space.',
      rebuild: true
    }),
    _number('Min radius',            GEM_SIZING, 'MIN_RADIUS', 1, 50, 1, {
      tip: 'Floor for narrow root streets so the gem stays visible.',
      rebuild: true
    }),
    _slider('Hover lift × street width', GEM_SIZING, 'HOVER_LIFT_FRAC', 0, 2, 0.05, {
      tip: 'Extra vertical lift above the road, on top of the gem radius.',
      onChange: applyTheme
    }),
    _number('Plaza clearance',       GEM_SIZING, 'BUILDING_CLEARANCE', 0, 100, 1, {
      tip: 'Dead-space pad past the gem at the root street\'s origin end.',
      rebuild: true
    })
  ]));

  section.appendChild(_subgroup('Appearance', [
    _color ('Edge color',   GEM_APPEARANCE, 'EDGE_COLOR', {
      tip: 'Neutral separator line drawn around each gem face.',
      onChange: applyTheme
    }),
    _slider('Body opacity', GEM_APPEARANCE, 'BODY_OPACITY', 0.0, 1.0, 0.05, {
      tip: 'Gem transparency. Low = jewel-like; high = plastic.',
      onChange: applyTheme
    })
  ]));

  section.appendChild(_subgroup('Animation', [
    _slider('Rotation speed', GEM_ANIMATION, 'ROTATION_SPEED',     0, 3,   0.05, { onChange: applyTheme }),
    _slider('Bob frequency',  GEM_ANIMATION, 'BOB_FREQUENCY',      0, 5,   0.1,  {
      tip: 'How fast the gem oscillates vertically.',
      onChange: applyTheme
    }),
    _slider('Bob amplitude',  GEM_ANIMATION, 'BOB_AMPLITUDE_FRAC', 0, 2,   0.05, {
      tip: 'Vertical bob distance, as a fraction of the gem radius.',
      onChange: applyTheme
    }),
    _slider('Hover scale',    GEM_ANIMATION, 'HOVER_SCALE',        1, 3,   0.05, {
      tip: 'Multiplier applied to the gem when the cursor is over it.',
      onChange: applyTheme
    }),
    _slider('Hover lerp',     GEM_ANIMATION, 'SCALE_LERP_SPEED', 0.01, 1, 0.01, {
      tip: 'Per-frame ease toward the hover scale.',
      onChange: applyTheme
    })
  ]));

  return section;
}


// ─── Effects ───────────────────────────────────────────────────────────────
function _buildEffectsSection(applyTheme) {
  var section = _section('Effects',
    'Shared visual effects.');

  section.appendChild(_subgroup('Rainbow (selected outline + path line)', [
    _slider('Speed',      RAINBOW, 'SPEED',      0, 0.005, 0.0001, {
      tip: 'Hue cycles per millisecond. The shared rainbow chases around the selected building outline AND the gem→selection path line.',
      onChange: applyTheme
    }),
    _slider('Saturation', RAINBOW, 'SATURATION', 0, 1, 0.05, { onChange: applyTheme }),
    _slider('Lightness',  RAINBOW, 'LIGHTNESS',  0, 1, 0.05, { onChange: applyTheme })
  ]));

  return section;
}


// ─── Sticky bottom action bar ──────────────────────────────────────────────
// "Rebuild" button (matches the small refresh-cw icon shown next to rows
// that need a rebuild) + a small "Reset all" link. Per-row reset icons
// cover the common case; "Reset all" stays understated as the global panic
// button.
//
// Both buttons clear the persisted camera pose ('cc.cameraPose', set by
// main.js) before reloading so the user lands at the freshly-fitted
// default view rather than wherever they last navigated. Hardcoded here
// instead of imported to avoid coupling controls UI to render-loop state.
var SAVED_CAMERA_KEY = 'cc.cameraPose';

function _clearSavedCameraPose() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVED_CAMERA_KEY);
  } catch (_) { /* private mode / unavailable — ignore */ }
}

function _buildActionsSection() {
  var actions = document.createElement('div');
  actions.className = 'controls-actions';

  var rebuildBtn = document.createElement('button');
  rebuildBtn.type = 'button';
  rebuildBtn.className = 'controls-button';
  rebuildBtn.appendChild(makeLucideIcon('refresh-cw', { class: 'controls-button-icon' }));
  rebuildBtn.appendChild(document.createTextNode('Rebuild'));
  rebuildBtn.title = 'Reload the page so rows marked with the rebuild icon take effect. Resets the camera too. Your tweaks persist.';
  rebuildBtn.addEventListener('click', function () {
    _clearSavedCameraPose();
    if (typeof location !== 'undefined') location.reload();
  });
  actions.appendChild(rebuildBtn);

  // Reset all — secondary button. Disabled when there's nothing to reset
  // (no overrides persisted), so the affordance only invites clicking when
  // there's actually something to do.
  var resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.className = 'controls-button controls-button-secondary';
  resetAll.appendChild(makeLucideIcon('rotate-ccw', { class: 'controls-button-icon' }));
  resetAll.appendChild(document.createTextNode('Reset all'));
  resetAll.title = 'Wipe every override (and reset the camera) and reload. (Per-row reset icons restore single values.)';
  resetAll.addEventListener('click', function () {
    if (resetAll.disabled) return;
    if (!confirm('Reset every override and reload?')) return;
    clearPersistence();
    _clearSavedCameraPose();
    if (typeof location !== 'undefined') location.reload();
  });
  actions.appendChild(resetAll);

  // Live enable/disable as values are tweaked or reset.
  function refreshResetAll() {
    resetAll.disabled = !hasAnyOverrides();
  }
  refreshResetAll();
  onAnyChange(refreshResetAll);

  return actions;
}


// ─── Section + subgroup primitives ─────────────────────────────────────────

function _section(name, hint) {
  var section = document.createElement('div');
  section.className = 'controls-section';

  var label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = name;
  section.appendChild(label);

  if (hint) {
    var h = document.createElement('div');
    h.className = 'controls-section-hint';
    h.textContent = hint;
    section.appendChild(h);
  }
  return section;
}

function _subgroup(name, rows) {
  var wrap = document.createElement('div');
  wrap.className = 'theme-subgroup';
  var h = document.createElement('div');
  h.className = 'theme-subgroup-label';
  h.textContent = name;
  wrap.appendChild(h);
  for (var i = 0; i < rows.length; i++) wrap.appendChild(rows[i]);
  return wrap;
}

// _row(labelText, control, store, keys, opts) -> <label>
//   store     — nanostore the control writes into; null skips the reset icon
//   keys      — array of keys this row covers (1 for single widgets, 2 for
//               rangePair). The reset icon shows when ANY key differs from
//               its registered default.
//   opts.tip      — full hover text (added to the row's title attribute)
//   opts.rebuild  — true → render a "↻" badge meaning "needs reload"
function _row(labelText, control, store, keys, opts) {
  opts = opts || {};
  var row = document.createElement('label');
  row.className = 'theme-row';

  var fullTip = labelText;
  if (opts.tip)     fullTip += ' — ' + opts.tip;
  if (opts.rebuild) fullTip += ' (Reload required for this change to take effect.)';
  row.title = fullTip;

  var span = document.createElement('span');
  span.className = 'theme-row-label';
  span.textContent = labelText;
  span.title = fullTip;
  row.appendChild(span);

  if (opts.rebuild) {
    // Subtle refresh-cw glyph next to the label — same icon as the
    // "Rebuild" button at the bottom, so the visual link is obvious:
    // "rows like this become live when you click Rebuild."
    var badge = makeLucideIcon('refresh-cw', {
      class: 'theme-row-rebuild-badge',
      title: 'Reload required to apply'
    });
    span.appendChild(badge);
  }

  var ctrlWrap = document.createElement('span');
  ctrlWrap.className = 'theme-row-control';
  ctrlWrap.appendChild(control);

  if (store && keys && keys.length) {
    var resetBtn = _makeResetButton(store, keys, opts);
    ctrlWrap.appendChild(resetBtn);
  }

  row.appendChild(ctrlWrap);
  return row;
}

// _makeResetButton(store, keys, opts) -> <button>
// Visible only when at least one of `keys` differs from its registered
// default. Click resets all listed keys, removes the matching localStorage
// entries (via _persist.js's resetKey), and fires opts.onChange so the
// scene/UI catches up immediately.
function _makeResetButton(store, keys, opts) {
  var onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : function () {};
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-row-reset';
  btn.title = _formatDefaultTooltip(store, keys);
  btn.setAttribute('aria-label', 'Reset to default');
  btn.appendChild(makeLucideIcon('rotate-ccw'));
  btn.addEventListener('click', function (e) {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    for (var i = 0; i < keys.length; i++) resetKey(store, keys[i]);
    onChange();
  });

  // Disabled when value matches default — keeps the icon in layout
  // (no UI bouncing) but only clickable when there's actually
  // something to reset.
  function refresh() {
    var state = store.get();
    var changed = false;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!_isEqual(state[k], getDefault(store, k))) { changed = true; break; }
    }
    btn.disabled = !changed;
  }
  refresh();
  store.subscribe(refresh);
  return btn;
}

// _formatDefaultTooltip(store, keys) -> "Default: <value>" / "Default: <lo> – <hi>"
// Used as the reset icon's hover title so the user can see what they'd revert
// to without clicking. Static — reads the registered default once.
function _formatDefaultTooltip(store, keys) {
  if (!keys || keys.length === 0) return 'Reset to default';
  if (keys.length === 1) {
    return 'Default: ' + _formatDefaultValue(getDefault(store, keys[0]));
  }
  // rangePair (2 keys: min, max)
  var lo = getDefault(store, keys[0]);
  var hi = getDefault(store, keys[1]);
  return 'Default: ' + _formatDefaultValue(lo) + ' – ' + _formatDefaultValue(hi);
}

function _formatDefaultValue(v) {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

function _isEqual(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch (_) { return false; }
}


// ─── Widget builders ───────────────────────────────────────────────────────

function _color(label, store, key, opts) {
  var onChange = _resolveChange(opts);
  var input = document.createElement('input');
  input.type = 'color';
  input.className = 'theme-color';
  input.value = _toHexInputValue(store.get()[key]);
  input.addEventListener('input', function () {
    store.setKey(key, input.value);
    onChange();
  });
  // Reflect outside changes (e.g. reset-to-default) back into the input.
  store.subscribe(function (state) {
    var hex = _toHexInputValue(state[key]);
    if (input.value.toLowerCase() !== hex) input.value = hex;
  });
  return _row(label, input, store, [key], opts);
}

function _number(label, store, key, min, max, step, opts) {
  var onChange = _resolveChange(opts);
  var input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(store.get()[key]);
  input.className = 'theme-number';
  input.addEventListener('input', function () {
    var v = parseFloat(input.value);
    if (Number.isFinite(v)) {
      store.setKey(key, v);
      onChange();
    }
  });
  store.subscribe(function (state) {
    var s = String(state[key]);
    if (input.value !== s && document.activeElement !== input) input.value = s;
  });
  return _row(label, input, store, [key], opts);
}

function _slider(label, store, key, min, max, step, opts) {
  var onChange = _resolveChange(opts);
  var refs = {};
  var control = _sliderWidget(store.get()[key], min, max, step, function (v) {
    store.setKey(key, v);
    onChange();
  }, refs);
  // Reflect outside changes (reset-to-default) back into the slider + readout.
  store.subscribe(function (state) {
    var v = state[key];
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, step);
    }
  });
  return _row(label, control, store, [key], opts);
}

// _nestedSlider — like _slider but the value lives at store.get()[parentKey][subKey].
// Writes go through `store.setKey(parentKey, { ...current, [subKey]: v })` so other
// sub-keys are preserved. The row's reset icon resets just `subKey` back to its
// registered default (not the whole map). Used for HUE_EXT_MAP per-extension rows.
//
// opts.previewHue — if true, appends a small HSL swatch that previews the
// current value as a hue (assumes the slider's value range is degrees).
function _nestedSlider(label, store, parentKey, subKey, min, max, step, opts) {
  var onChange = _resolveChange(opts);
  var refs = {};
  var initial = (store.get()[parentKey] || {})[subKey];

  var swatch = null;
  if (opts && opts.previewHue) {
    swatch = document.createElement('span');
    swatch.className = 'theme-hue-preview';
    swatch.style.background = 'hsl(' + initial + ', 80%, 55%)';
  }

  var control = _sliderWidget(initial, min, max, step, function (v) {
    var current = store.get()[parentKey] || {};
    var next = {};
    for (var k in current) {
      if (Object.prototype.hasOwnProperty.call(current, k)) next[k] = current[k];
    }
    next[subKey] = v;
    store.setKey(parentKey, next);
    if (swatch) swatch.style.background = 'hsl(' + v + ', 80%, 55%)';
    onChange();
  }, refs);

  store.subscribe(function (state) {
    var v = (state[parentKey] || {})[subKey];
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, step);
      if (swatch) swatch.style.background = 'hsl(' + v + ', 80%, 55%)';
    }
  });

  // Reset icon: visible when this sub-key differs from its registered default.
  // Click resets only this sub-key.
  var rowOpts = {};
  for (var ok in opts) if (Object.prototype.hasOwnProperty.call(opts, ok)) rowOpts[ok] = opts[ok];

  var row = _row(label, control, null, null, rowOpts);
  var ctrlWrap = row.querySelector('.theme-row-control');
  if (swatch) ctrlWrap.appendChild(swatch);
  var resetBtn = _makeNestedResetButton(store, parentKey, subKey, opts);
  ctrlWrap.appendChild(resetBtn);
  return row;
}

function _makeNestedResetButton(store, parentKey, subKey, opts) {
  var onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : function () {};
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-row-reset';
  btn.setAttribute('aria-label', 'Reset to default');
  btn.appendChild(makeLucideIcon('rotate-ccw'));

  var defaultMap = getDefault(store, parentKey) || {};
  var defaultVal = defaultMap[subKey];
  btn.title = 'Default: ' + _formatDefaultValue(defaultVal);

  btn.addEventListener('click', function (e) {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    var current = store.get()[parentKey] || {};
    var next = {};
    for (var k in current) {
      if (Object.prototype.hasOwnProperty.call(current, k)) next[k] = current[k];
    }
    next[subKey] = defaultVal;
    store.setKey(parentKey, next);
    onChange();
  });

  function refresh() {
    var v = (store.get()[parentKey] || {})[subKey];
    btn.disabled = _isEqual(v, defaultVal);
  }
  refresh();
  store.subscribe(refresh);
  return btn;
}

// _select — segmented radio for an enum-valued key. `options` is an array
// of { value, label }. Renders one button per option; clicking sets the
// store key. The active option has .is-active.
function _select(label, store, key, options, opts) {
  var onChange = _resolveChange(opts);
  var wrap = document.createElement('span');
  wrap.className = 'theme-select';

  var buttons = [];
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-select-option';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    (function (value) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        store.setKey(key, value);
        onChange();
      });
    })(opt.value);
    wrap.appendChild(btn);
    buttons.push(btn);
  }

  function refresh() {
    var current = store.get()[key];
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].classList.toggle('is-active', buttons[j].dataset.value === current);
    }
  }
  refresh();
  store.subscribe(refresh);
  return _row(label, wrap, store, [key], opts);
}

// _toggle — boolean checkbox. Reflects external changes (reset-to-default).
function _toggle(label, store, key, opts) {
  var onChange = _resolveChange(opts);
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'theme-toggle';
  input.checked = !!store.get()[key];
  input.addEventListener('change', function () {
    store.setKey(key, input.checked);
    onChange();
  });
  store.subscribe(function (state) {
    var v = !!state[key];
    if (input.checked !== v) input.checked = v;
  });
  return _row(label, input, store, [key], opts);
}

function _rangePair(label, store, minKey, maxKey, lo, hi, step, opts) {
  var onChange = _resolveChange(opts);
  var current = store.get();

  var pair = document.createElement('span');
  pair.className = 'theme-range-pair';

  var track = document.createElement('span');
  track.className = 'theme-range-pair-track';
  pair.appendChild(track);

  var fill = document.createElement('span');
  fill.className = 'theme-range-pair-fill';
  pair.appendChild(fill);

  function makeRange(value) {
    var r = document.createElement('input');
    r.type = 'range';
    r.min = String(lo);
    r.max = String(hi);
    r.step = String(step);
    r.value = String(value);
    return r;
  }
  var loRange = makeRange(current[minKey]);
  loRange.classList.add('theme-range-pair-lo');
  var hiRange = makeRange(current[maxKey]);
  hiRange.classList.add('theme-range-pair-hi');
  pair.appendChild(loRange);
  pair.appendChild(hiRange);

  var readout = document.createElement('span');
  readout.className = 'theme-slider-readout';

  function paint() {
    var l = parseFloat(loRange.value);
    var h = parseFloat(hiRange.value);
    var span = (hi - lo) || 1;
    fill.style.left  = ((l - lo) / span * 100) + '%';
    fill.style.right = ((hi - h) / span * 100) + '%';
    readout.textContent = _formatNumberForStep(l, step) + ' – ' + _formatNumberForStep(h, step);
  }

  function commit() {
    var l = parseFloat(loRange.value);
    var h = parseFloat(hiRange.value);
    if (!Number.isFinite(l) || !Number.isFinite(h)) return;
    if (l > h) { l = h; loRange.value = String(l); }
    if (h < l) { h = l; hiRange.value = String(h); }
    store.setKey(minKey, l);
    store.setKey(maxKey, h);
    paint();
    onChange();
  }

  loRange.addEventListener('input', commit);
  hiRange.addEventListener('input', commit);
  paint();

  // Reflect outside changes (reset-to-default) back into both thumbs.
  store.subscribe(function (state) {
    var changed = false;
    if (parseFloat(loRange.value) !== state[minKey]) {
      loRange.value = String(state[minKey]);
      changed = true;
    }
    if (parseFloat(hiRange.value) !== state[maxKey]) {
      hiRange.value = String(state[maxKey]);
      changed = true;
    }
    if (changed) paint();
  });

  var wrap = document.createElement('span');
  wrap.className = 'theme-slider-wrap';
  wrap.appendChild(pair);
  wrap.appendChild(readout);
  return _row(label, wrap, store, [minKey, maxKey], opts);
}

// Shared slider+readout DOM construction. Returns the wrapper; the caller
// passes a `refs` object to receive the {range, readout} inner nodes (so
// store.subscribe can drive them on external value changes).
function _sliderWidget(initialValue, min, max, step, onCommit, refs) {
  var wrap = document.createElement('span');
  wrap.className = 'theme-slider-wrap';

  var range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(initialValue);
  range.className = 'theme-slider';

  var readout = document.createElement('span');
  readout.className = 'theme-slider-readout';
  readout.textContent = _formatNumberForStep(initialValue, step);

  range.addEventListener('input', function () {
    var v = parseFloat(range.value);
    if (!Number.isFinite(v)) return;
    readout.textContent = _formatNumberForStep(v, step);
    onCommit(v);
  });

  wrap.appendChild(range);
  wrap.appendChild(readout);
  if (refs) { refs.range = range; refs.readout = readout; }
  return wrap;
}

// onChange resolution: hot-reload rows pass `applyTheme` as opts.onChange;
// rebuild rows just persist (no immediate handler).
function _resolveChange(opts) {
  if (opts && typeof opts.onChange === 'function') return opts.onChange;
  return function () {};
}

// Color <input type="color"> only accepts #RRGGBB. Convert from any CSS
// color string (rgba, named, etc.) to that form by round-tripping through
// a temporary DOM element so the browser does the parsing for us.
function _toHexInputValue(cssColor) {
  if (typeof cssColor !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(cssColor)) return cssColor.toLowerCase();
  if (typeof document === 'undefined') return '#000000';
  var probe = document.createElement('span');
  probe.style.color = cssColor;
  document.body.appendChild(probe);
  var computed = getComputedStyle(probe).color;     // → "rgb(R, G, B)"
  document.body.removeChild(probe);
  var m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  var r = parseInt(m[1], 10).toString(16).padStart(2, '0');
  var g = parseInt(m[2], 10).toString(16).padStart(2, '0');
  var b = parseInt(m[3], 10).toString(16).padStart(2, '0');
  return '#' + r + g + b;
}

// _formatNumberForStep(v, step) — derive readout precision from the slider
// step. A step of 0.0001 needs 4 decimals to render meaningful changes;
// a step of 50 should render as an integer.
function _formatNumberForStep(v, step) {
  if (!Number.isFinite(v)) return String(v);
  var s = Math.abs(step);
  if (s >= 1) return v.toFixed(0);
  var stepStr = String(step);
  var dot = stepStr.indexOf('.');
  var decimals = dot === -1 ? 0 : (stepStr.length - dot - 1);
  if (decimals > 6) decimals = 6;
  return v.toFixed(decimals);
}

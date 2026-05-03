// controls.js — "Controls" tab in the left sidebar.
//
// Layout: a header, a View section (Reset View + keyboard hints), then one
// section PER scene element (Background, Streets, Buildings, Gem, Camera,
// Input feel, Effects). Within each section, rows are mixed: hot-reloadable
// rows apply immediately via applyTheme(), rebuild-required rows show a "↻"
// badge so the user knows to click "Apply & Reload" at the bottom.
//
// Why one section per scene element instead of Theme/Advanced split?
// Because the user thinks "I want to change something about street labels",
// not "I want to change a hot-reloadable thing." Grouping by what's being
// styled keeps related knobs together.

import {
  // Background
  SCENE_COLORS,
  // Streets
  ASPHALT, SIDEWALK_COLORS, LABEL_TYPOGRAPHY, PATH_LINE, STREET_LAYOUT,
  // Buildings
  BUILDING_DIMENSIONS, BUILDING_PALETTE, BUILDING_OUTLINE, BUILDING_FADE,
  // Gem
  GEM_SIZING, GEM_APPEARANCE, GEM_ANIMATION,
  // Camera
  CAMERA_PERSPECTIVE, CAMERA_CONTROLS, CAMERA_ANIMATION,
  // Input feel
  INPUT_TIMING, TOOLTIP,
  // Effects
  RAINBOW
} from '../config/index.js';
import { clearPersistence } from '../config/_persist.js';

// buildControlsPane(opts) -> HTMLElement
//
// opts:
//   onResetView — fn() invoked when the user clicks "Reset View"
//   applyTheme  — fn() invoked after any hot-reloadable mutation; flushes
//                 the change through to live materials. Optional.
export function buildControlsPane(opts) {
  opts = opts || {};
  var onReset    = opts.onResetView || function () {};
  var applyTheme = opts.applyTheme  || function () {};

  var pane = document.createElement('div');
  pane.className = 'left-pane controls-pane';

  var header = document.createElement('div');
  header.className = 'controls-header';
  var title = document.createElement('h3');
  title.className = 'controls-title';
  title.textContent = 'Controls';
  header.appendChild(title);
  pane.appendChild(header);

  var body = document.createElement('div');
  body.className = 'controls-body';

  body.appendChild(_buildViewSection(onReset));
  body.appendChild(_buildBackgroundSection(applyTheme));
  body.appendChild(_buildStreetsSection(applyTheme));
  body.appendChild(_buildBuildingsSection(applyTheme));
  body.appendChild(_buildGemSection(applyTheme));
  body.appendChild(_buildCameraSection(applyTheme));
  body.appendChild(_buildInputSection(applyTheme));
  body.appendChild(_buildEffectsSection(applyTheme));
  body.appendChild(_buildActionsSection());

  pane.appendChild(body);
  return pane;
}


// ─── View ──────────────────────────────────────────────────────────────────
function _buildViewSection(onReset) {
  var section = _section('View',
    'Camera + scene controls. Pivot follows what you point at.');

  var hint = document.createElement('div');
  hint.className = 'controls-section-hint';
  hint.innerHTML =
    'Double-click or press <kbd>F</kbd> to pivot rotation on what your cursor is over. ' +
    'Press <kbd>R</kbd> to reset the view.';
  section.appendChild(hint);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'controls-button';
  btn.textContent = 'Reset View';
  btn.addEventListener('click', function () { onReset(); });
  section.appendChild(btn);

  return section;
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
// Asphalt + sidewalks + street-labels + the gem→selection neon path. All
// lumped together because they share a real-world referent: roads.
function _buildStreetsSection(applyTheme) {
  var section = _section('Streets',
    'Asphalt, sidewalks, street labels, and the neon path that highlights the route from the root gem to the selected file.');

  // Asphalt
  section.appendChild(_subgroup('Asphalt', [
    _color('Color',                ASPHALT, 'COLOR', {
      tip: 'Color of the inner road stripe. Live.',
      onChange: applyTheme
    }),
    _slider('Width × street width', ASPHALT, 'WIDTH_FRAC', 0.1, 1, 0.05, {
      tip: 'Asphalt width as a fraction of the street width — the rest is sidewalk strip on each side.',
      rebuild: true
    }),
    _slider('Length floor × street length', ASPHALT, 'LENGTH_MIN_FRAC', 0, 1, 0.05, {
      tip: 'Floor on the asphalt length so very short streets still show some asphalt.',
      rebuild: true
    })
  ]));

  // Sidewalks (state-driven tints)
  section.appendChild(_subgroup('Sidewalk colors', [
    _color('Default',  SIDEWALK_COLORS, 'DEFAULT',  { tip: 'Resting tint on every sidewalk.', onChange: applyTheme }),
    _color('Hover',    SIDEWALK_COLORS, 'HOVER',    { tip: 'When the cursor is over a street.', onChange: applyTheme }),
    _color('Selected', SIDEWALK_COLORS, 'SELECTED', { tip: 'When a street (directory) is selected.', onChange: applyTheme }),
    _color('Path',     SIDEWALK_COLORS, 'PATH',     { tip: 'Streets in the lineage from the root gem to the current selection.', onChange: applyTheme })
  ]));

  // Street labels (typography + flip)
  section.appendChild(_subgroup('Street labels', [
    _color ('Fill',                 LABEL_TYPOGRAPHY, 'FILL', {
      tip: 'Text color of the names painted on each road.',
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
      rebuild: true
    }),
    _slider('Repeat spacing × label width', LABEL_TYPOGRAPHY, 'SPACING_MULT', 0.5, 10, 0.1, {
      tip: 'Distance between label repeats along a long street, expressed as a multiple of the label width.',
      rebuild: true
    }),
    _number('Repeat spacing floor', LABEL_TYPOGRAPHY, 'SPACING_FLOOR', 0, 1000, 10, {
      tip: 'Minimum repeat distance in world units (so tiny labels do not pile up).',
      rebuild: true
    }),
    _slider('Lift above asphalt',   LABEL_TYPOGRAPHY, 'ELEVATION', 0, 5, 0.1, {
      tip: 'Vertical offset of the label plane above the road, to avoid z-fighting.',
      rebuild: true
    })
  ]));

  // Path line (gem → selection)
  section.appendChild(_subgroup('Selection path line', [
    _number('Linewidth', PATH_LINE, 'LINEWIDTH', 1, 20, 1, {
      tip: 'Pixel thickness of the rainbow line that traces gem → selected file.',
      onChange: applyTheme
    }),
    _slider('Opacity',   PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
      tip: 'Path-line transparency. 0 = invisible; 1 = solid.',
      onChange: applyTheme
    })
  ]));

  // Street layout / packing (rebuild-required)
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

  // Dimensions
  section.appendChild(_subgroup('Size', [
    _rangePair('Floors range',  BUILDING_DIMENSIONS, 'MIN_FLOORS', 'MAX_FLOORS', 1, 200, 1, {
      tip: 'Smallest file in the project lands at MIN floors; largest at MAX. Everything else interpolated by sqrt of line count.',
      rebuild: true
    }),
    _number('Floor height',     BUILDING_DIMENSIONS, 'FLOOR_HEIGHT', 1, 50, 1, {
      tip: 'Vertical world units per floor.',
      rebuild: true
    }),
    _rangePair('Width range',   BUILDING_DIMENSIONS, 'MIN_WIDTH', 'MAX_WIDTH', 1, 200, 1, {
      tip: 'Smallest file lands at MIN width; largest at MAX. Interpolated by log of byte size. Footprints are square (depth = width).',
      rebuild: true
    }),
    _number('Sidewalk gap',     BUILDING_DIMENSIONS, 'STREET_GAP', 0, 50, 1, {
      tip: 'Empty space the building leaves between its wall and the adjacent sidewalk. The path connector strip exactly bridges this gap.',
      rebuild: true
    })
  ]));

  // Palette
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

  // Outlines (live)
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

  // Fade (live)
  section.appendChild(_subgroup('Selection fade', [
    _slider('Fade speed',         BUILDING_FADE, 'LERP_SPEED', 0.01, 1.0, 0.01, {
      tip: 'Per-frame easing toward the target opacity. Higher = snappier transitions.',
      onChange: applyTheme
    }),
    _rangePair('Crossfade band',  BUILDING_FADE, 'FADE_BOTTOM', 'FADE_TOP', 0.0, 1.0, 0.05, {
      tip: 'Opacity band over which buildings cross-fade between textured (windowed) and solid-color "ghost" forms. Anything below the bottom is windowless.',
      onChange: applyTheme
    }),
    _slider('Near body',          BUILDING_FADE, 'TIER_NEAR_BODY',    0.0, 1.0, 0.05, {
      tip: 'Opacity for buildings 1 hop from the selection (parent\'s siblings, direct subdir files).',
      onChange: applyTheme
    }),
    _slider('Near outline',       BUILDING_FADE, 'TIER_NEAR_OUTLINE', 0.0, 1.0, 0.05, { onChange: applyTheme }),
    _slider('Near ghost',         BUILDING_FADE, 'TIER_NEAR_GHOST',   0.0, 1.0, 0.05, { onChange: applyTheme }),
    _slider('Far body',           BUILDING_FADE, 'TIER_FAR_BODY',     0.0, 1.0, 0.05, {
      tip: 'Opacity for buildings ≥2 hops from the selection (cousins, deeper subtrees).',
      onChange: applyTheme
    }),
    _slider('Far outline',        BUILDING_FADE, 'TIER_FAR_OUTLINE',  0.0, 1.0, 0.05, { onChange: applyTheme }),
    _slider('Far ghost',          BUILDING_FADE, 'TIER_FAR_GHOST',    0.0, 1.0, 0.05, { onChange: applyTheme }),
    _slider('Hover min opacity',  BUILDING_FADE, 'HOVER_MIN_OPACITY', 0.0, 1.0, 0.05, {
      tip: 'A hovered file building never drops below this opacity, even if it sits in the FAR tier.',
      onChange: applyTheme
    })
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
      rebuild: true
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


// ─── Camera ────────────────────────────────────────────────────────────────
function _buildCameraSection(applyTheme) {
  var section = _section('Camera',
    'Perspective lens, orbit controls, and animation timings.');

  section.appendChild(_subgroup('Perspective', [
    _number('FOV (deg)', CAMERA_PERSPECTIVE, 'FOV',  10, 120, 1, {
      tip: 'Vertical field-of-view. Lower = telephoto compression; higher = wide-angle distortion.',
      rebuild: true
    }),
    _number('Near clip', CAMERA_PERSPECTIVE, 'NEAR', 0.1, 100, 0.1, { rebuild: true }),
    _number('Far clip',  CAMERA_PERSPECTIVE, 'FAR',  1000, 100000, 1000, { rebuild: true })
  ]));

  section.appendChild(_subgroup('Orbit + zoom', [
    _slider('Damping',                CAMERA_CONTROLS, 'DAMPING_FACTOR',        0, 1, 0.01, {
      tip: 'OrbitControls inertia. Higher = snappier; lower = floatier.',
      rebuild: true
    }),
    _slider('Polar limit × π',         CAMERA_CONTROLS, 'MAX_POLAR_ANGLE_FRAC',  0, 0.5, 0.01, {
      tip: 'How close to vertical the orbit can go (× π radians).',
      rebuild: true
    }),
    _number('Min zoom distance',      CAMERA_CONTROLS, 'MIN_DISTANCE',          1, 1000, 1, { rebuild: true }),
    _slider('Initial framing',        CAMERA_CONTROLS, 'INITIAL_DISTANCE_MULT', 0.1, 3, 0.05, {
      tip: 'Tightness on boot — 1.0 fits exactly; <1.0 is tighter; >1.0 leaves headroom.',
      rebuild: true
    })
  ]));

  section.appendChild(_subgroup('Animation timings', [
    _number('Recenter (ms)',        CAMERA_ANIMATION, 'RECENTER_DURATION_MS',     50, 2000, 50, { onChange: applyTheme }),
    _number('Reset (ms)',           CAMERA_ANIMATION, 'RESET_DURATION_MS',        50, 2000, 50, { onChange: applyTheme }),
    _number('Building focus (ms)',  CAMERA_ANIMATION, 'BUILDING_FOCUS_DURATION_MS', 50, 2000, 50, { onChange: applyTheme }),
    _number('Street focus (ms)',    CAMERA_ANIMATION, 'STREET_FOCUS_DURATION_MS',   50, 2000, 50, { onChange: applyTheme }),
    _slider('Street view length',   CAMERA_ANIMATION, 'STREET_FOCUS_LENGTH_FRAC',  0.1, 1.5, 0.05, {
      tip: 'Visible portion of the street when "focus on street" fires, as a fraction of full length.',
      onChange: applyTheme
    }),
    _number('Street view width ×',  CAMERA_ANIMATION, 'STREET_FOCUS_WIDTH_MULT',   1, 20, 1, {
      tip: 'Visible width = street width × this.',
      onChange: applyTheme
    }),
    _number('Street view elevation (deg)', CAMERA_ANIMATION, 'STREET_FOCUS_ELEVATION_DEG', 30, 89, 1, {
      tip: 'Camera elevation when focused on a street. 90° is straight down.',
      onChange: applyTheme
    })
  ]));

  return section;
}


// ─── Input feel ────────────────────────────────────────────────────────────
function _buildInputSection(applyTheme) {
  var section = _section('Input feel',
    'Pointer click-vs-drag thresholds, hover commit timing, tooltip placement.');

  section.appendChild(_subgroup('Pointer', [
    _number('Hover commit (ms)',   INPUT_TIMING, 'HOVER_COMMIT_MS',         0,   500, 5, {
      tip: 'How long the cursor must hold on a target before the heavy fade cascade engages. Brief brushes never commit.',
      onChange: applyTheme
    }),
    _number('Click move threshold (px)', INPUT_TIMING, 'CLICK_MOVE_THRESHOLD_PX', 1, 50, 1, {
      tip: 'Pointer must move less than this between down + up to count as a click vs. a drag.',
      onChange: applyTheme
    }),
    _number('Click time threshold (ms)', INPUT_TIMING, 'CLICK_TIME_THRESHOLD_MS', 100, 1000, 50, {
      tip: 'Pointer must release within this window of pressing for it to count as a click.',
      onChange: applyTheme
    })
  ]));

  section.appendChild(_subgroup('Tooltip', [
    _number('Cursor offset (px)',    TOOLTIP, 'OFFSET_PX',          0, 40, 1, {
      tip: 'Distance from the cursor to the tooltip\'s edge.',
      onChange: applyTheme
    }),
    _number('Viewport margin (px)',  TOOLTIP, 'VIEWPORT_MARGIN_PX', 0, 20, 1, {
      tip: 'Safety margin from the viewport edges so the tooltip never clips off-screen.',
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


// ─── Action buttons ────────────────────────────────────────────────────────
function _buildActionsSection() {
  var actions = document.createElement('div');
  actions.className = 'controls-actions';

  var applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'controls-button';
  applyBtn.textContent = 'Apply & Reload';
  applyBtn.title = 'Reload the page so rebuild-required changes (marked ↻) take effect. Your tweaks persist across reloads.';
  applyBtn.addEventListener('click', function () {
    if (typeof location !== 'undefined') location.reload();
  });
  actions.appendChild(applyBtn);

  var resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'controls-button controls-button-secondary';
  resetBtn.textContent = 'Reset to Defaults';
  resetBtn.title = 'Wipe all overrides and reload.';
  resetBtn.addEventListener('click', function () {
    if (!confirm('Reset every override and reload?')) return;
    clearPersistence();
    if (typeof location !== 'undefined') location.reload();
  });
  actions.appendChild(resetBtn);

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

// _row(labelText, control, opts) -> <label>
//   opts.tip      — full hover text (added to the row's title attribute)
//   opts.rebuild  — true → render a "↻" badge meaning "needs reload"
function _row(labelText, control, opts) {
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
    var badge = document.createElement('span');
    badge.className = 'theme-row-rebuild-badge';
    badge.textContent = '↻';
    badge.title = 'Reload required';
    span.appendChild(badge);
  }

  var ctrlWrap = document.createElement('span');
  ctrlWrap.className = 'theme-row-control';
  ctrlWrap.appendChild(control);
  row.appendChild(ctrlWrap);
  return row;
}

// onChange resolution: hot-reload rows pass `applyTheme` as opts.onChange;
// rebuild rows just persist (no immediate handler).
function _resolveChange(opts) {
  if (opts && typeof opts.onChange === 'function') return opts.onChange;
  return function () {};
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
  return _row(label, input, opts);
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
  return _row(label, input, opts);
}

function _slider(label, store, key, min, max, step, opts) {
  var onChange = _resolveChange(opts);
  var control = _sliderWidget(store.get()[key], min, max, step, function (v) {
    store.setKey(key, v);
    onChange();
  });
  return _row(label, control, opts);
}

// _rangePair — dual-thumb slider for paired MIN/MAX values. Two stacked
// native range inputs share a track; the fill bar between thumbs is
// repainted on every input event.
function _rangePair(label, store, minKey, maxKey, lo, hi, step, opts) {
  var onChange = _resolveChange(opts);
  var current = store.get();
  var loVal = current[minKey];
  var hiVal = current[maxKey];

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
  var loRange = makeRange(loVal);
  loRange.classList.add('theme-range-pair-lo');
  var hiRange = makeRange(hiVal);
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

  var wrap = document.createElement('span');
  wrap.className = 'theme-slider-wrap';
  wrap.appendChild(pair);
  wrap.appendChild(readout);
  return _row(label, wrap, opts);
}

// Shared slider+readout DOM construction.
function _sliderWidget(initialValue, min, max, step, onCommit) {
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
  return wrap;
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
  // Count digits after the decimal point in the step.
  var stepStr = String(step);
  var dot = stepStr.indexOf('.');
  var decimals = dot === -1 ? 0 : (stepStr.length - dot - 1);
  if (decimals > 6) decimals = 6;
  return v.toFixed(decimals);
}

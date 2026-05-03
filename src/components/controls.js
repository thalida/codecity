// controls.js — "Controls" tab in the left sidebar. Holds:
//   - View      — Reset View button + keyboard hints
//   - Theme     — hot-reload-safe knobs sourced from src/config/* stores;
//                 mutating any value calls applyTheme() to flush material-
//                 level updates into the live scene
//   - Advanced  — rebuild-required knobs (layout dimensions, building
//                 textures, label typography, etc.). The Apply & Reload
//                 button at the bottom does location.reload() — the
//                 changes survive because every store is mirrored to
//                 localStorage by config/_persist.js.
//
// What's NOT exposed here (still in config for code-level centralization,
// just not surfaced as a UI control because it's either engine-internal
// or designer-only fine tuning):
//   - RENDER_ORDERS, GLYPHS, UI_TEXT, UI_TIMING, ACTIVITY_BAR_TABS,
//     LUCIDE_ICON_BASE_URL, BYTE_FORMATTING, DATE_FORMAT_OPTIONS,
//     NUMBER_READOUT  — engine + UI plumbing
//   - BUILDING_SHADING, BUILDING_FACADE, BUILDING_PALETTE.HUE_EXT_MAP —
//     facade rendering minutiae
//   - CAMERA_ANIMATION sightline knobs — obstacle-detection internals
//   - STREET_TIERS — needs a tier-list editor, not a slider

import {
  // Theme (hot-reloadable) stores
  SCENE_COLORS, ASPHALT, SIDEWALK_COLORS, BUILDING_OUTLINE, BUILDING_FADE,
  PIVOT_PING, PATH_LINE, GEM_ANIMATION, GEM_APPEARANCE, TOOLTIP,
  INPUT_TIMING, SIDEBAR_BADGE, LABEL_TYPOGRAPHY,
  // Advanced (rebuild-required) stores
  LAYOUT_GAPS, BUILDING_DIMENSIONS, BUILDING_PALETTE, GEM_SIZING,
  CAMERA_PERSPECTIVE, CAMERA_CONTROLS, CAMERA_ANIMATION,
  // UI text + glyphs
  UI_TEXT
} from '../config/index.js';
import { clearPersistence } from '../config/_persist.js';

// 1 MB in bytes — surface SIZE_CEILING_BYTES in MB units for readability.
var BYTES_PER_MB = 1024 * 1024;

// buildControlsPane(opts) -> HTMLElement
//
// opts:
//   onResetView — fn() called when the user clicks "Reset View".
//   applyTheme  — fn() called after any Theme mutation; flushes the
//                 change through to live materials. Optional — Theme
//                 widgets still mutate their stores either way.
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
  title.textContent = UI_TEXT.get().CONTROLS_TITLE;
  header.appendChild(title);
  pane.appendChild(header);

  var body = document.createElement('div');
  body.className = 'controls-body';

  body.appendChild(_buildViewSection(onReset));
  body.appendChild(_buildThemeSection(applyTheme));
  body.appendChild(_buildAdvancedSection());

  pane.appendChild(body);
  return pane;
}


// ─── View ──────────────────────────────────────────────────────────────────
function _buildViewSection(onReset) {
  var section = document.createElement('div');
  section.className = 'controls-section';

  var label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = 'View';
  section.appendChild(label);

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


// ─── Theme (hot-reloadable) ────────────────────────────────────────────────
function _buildThemeSection(applyTheme) {
  var section = document.createElement('div');
  section.className = 'controls-section';

  var label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = 'Theme';
  section.appendChild(label);

  var hint = document.createElement('div');
  hint.className = 'controls-section-hint';
  hint.textContent = 'Live tweaks — colors, fade tiers, hover stickiness. Changes apply immediately.';
  section.appendChild(hint);

  // ── Background ─────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Background', [
    _color('Ground',  SCENE_COLORS, 'GROUND', applyTheme),
    _color('Asphalt', ASPHALT,      'COLOR',  applyTheme)
  ]));

  // ── Sidewalks ──────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Sidewalks', [
    _color('Default',  SIDEWALK_COLORS, 'DEFAULT',  applyTheme),
    _color('Hover',    SIDEWALK_COLORS, 'HOVER',    applyTheme),
    _color('Selected', SIDEWALK_COLORS, 'SELECTED', applyTheme),
    _color('Path',     SIDEWALK_COLORS, 'PATH',     applyTheme)
  ]));

  // ── Building outlines ──────────────────────────────────────────────────
  section.appendChild(_subgroup('Outlines', [
    _number('Default linewidth',  BUILDING_OUTLINE, 'DEFAULT_LINEWIDTH',  1, 10, 1, applyTheme),
    _color ('Hover color',        BUILDING_OUTLINE, 'HOVER_COLOR',                  applyTheme),
    _number('Hover linewidth',    BUILDING_OUTLINE, 'HOVER_LINEWIDTH',    1, 10, 1, applyTheme),
    _slider('Hover opacity',      BUILDING_OUTLINE, 'HOVER_OPACITY',      0, 1, 0.05, applyTheme),
    _number('Selected linewidth', BUILDING_OUTLINE, 'SELECTED_LINEWIDTH', 1, 10, 1, applyTheme),
    _slider('Selected opacity',   BUILDING_OUTLINE, 'SELECTED_OPACITY',   0, 1, 0.05, applyTheme),
    _slider('Rainbow speed',      BUILDING_OUTLINE, 'RAINBOW_SPEED',      0, 0.005, 0.0001, applyTheme),
    _slider('Rainbow saturation', BUILDING_OUTLINE, 'RAINBOW_SATURATION', 0, 1, 0.05, applyTheme),
    _slider('Rainbow lightness',  BUILDING_OUTLINE, 'RAINBOW_LIGHTNESS',  0, 1, 0.05, applyTheme)
  ]));

  // ── Fade tiers ─────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Fade animation', [
    _slider('Lerp speed',        BUILDING_FADE, 'LERP_SPEED',     0.01, 1.0,  0.01, applyTheme),
    _slider('Fade top',          BUILDING_FADE, 'FADE_TOP',       0.0,  1.0,  0.05, applyTheme),
    _slider('Fade bottom',       BUILDING_FADE, 'FADE_BOTTOM',    0.0,  1.0,  0.05, applyTheme),
    _slider('Near body',         BUILDING_FADE, 'TIER_NEAR_BODY',    0.0, 1.0, 0.05, applyTheme),
    _slider('Near outline',      BUILDING_FADE, 'TIER_NEAR_OUTLINE', 0.0, 1.0, 0.05, applyTheme),
    _slider('Near ghost',        BUILDING_FADE, 'TIER_NEAR_GHOST',   0.0, 1.0, 0.05, applyTheme),
    _slider('Far body',          BUILDING_FADE, 'TIER_FAR_BODY',     0.0, 1.0, 0.05, applyTheme),
    _slider('Far outline',       BUILDING_FADE, 'TIER_FAR_OUTLINE',  0.0, 1.0, 0.05, applyTheme),
    _slider('Far ghost',         BUILDING_FADE, 'TIER_FAR_GHOST',    0.0, 1.0, 0.05, applyTheme),
    _slider('Hover min opacity', BUILDING_FADE, 'HOVER_MIN_OPACITY', 0.0, 1.0, 0.05, applyTheme)
  ]));

  // ── Interaction feel ───────────────────────────────────────────────────
  section.appendChild(_subgroup('Interaction', [
    _number('Hover commit (ms)',   INPUT_TIMING, 'HOVER_COMMIT_MS',         0,   500, 5, applyTheme),
    _number('Click move px',       INPUT_TIMING, 'CLICK_MOVE_THRESHOLD_PX', 1,    50, 1, applyTheme),
    _number('Click time (ms)',     INPUT_TIMING, 'CLICK_TIME_THRESHOLD_MS', 100, 1000, 50, applyTheme),
    _number('Tooltip offset (px)', TOOLTIP,      'OFFSET_PX',               0,    40, 1, applyTheme),
    _number('Tooltip viewport pad', TOOLTIP,     'VIEWPORT_MARGIN_PX',      0,    20, 1, applyTheme)
  ]));

  // ── Pivot ping ─────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Pivot ping', [
    _color ('Color',          PIVOT_PING, 'COLOR',                  applyTheme),
    _number('Duration (ms)',  PIVOT_PING, 'DURATION_MS',  100, 2000, 50, applyTheme),
    _slider('Start opacity',  PIVOT_PING, 'START_OPACITY', 0.0, 1.0, 0.05, applyTheme),
    _slider('Start scale',    PIVOT_PING, 'START_SCALE',   0.1, 5.0, 0.1, applyTheme),
    _slider('End scale',      PIVOT_PING, 'END_SCALE',     0.1, 10,  0.1, applyTheme)
  ]));

  // ── Path line ──────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Path line', [
    _number('Linewidth',          PATH_LINE, 'LINEWIDTH',         1, 20, 1, applyTheme),
    _slider('Opacity',            PATH_LINE, 'OPACITY',           0.0, 1.0, 0.05, applyTheme),
    _slider('Rainbow speed',      PATH_LINE, 'RAINBOW_SPEED',     0, 0.005, 0.0001, applyTheme),
    _slider('Rainbow saturation', PATH_LINE, 'RAINBOW_SATURATION', 0, 1, 0.05, applyTheme),
    _slider('Rainbow lightness',  PATH_LINE, 'RAINBOW_LIGHTNESS', 0, 1, 0.05, applyTheme)
  ]));

  // ── Root gem ───────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Root gem', [
    _color ('Edge color',     GEM_APPEARANCE, 'EDGE_COLOR',                       applyTheme),
    _slider('Body opacity',   GEM_APPEARANCE, 'BODY_OPACITY',         0.0, 1.0, 0.05, applyTheme),
    _slider('Rotation speed', GEM_ANIMATION,  'ROTATION_SPEED',         0, 3,   0.05, applyTheme),
    _slider('Bob frequency',  GEM_ANIMATION,  'BOB_FREQUENCY',          0, 5,   0.1,  applyTheme),
    _slider('Bob amplitude',  GEM_ANIMATION,  'BOB_AMPLITUDE_FRAC',     0, 2,   0.05, applyTheme),
    _slider('Hover scale',    GEM_ANIMATION,  'HOVER_SCALE',            1, 3,   0.05, applyTheme),
    _slider('Scale lerp',     GEM_ANIMATION,  'SCALE_LERP_SPEED',    0.01, 1,   0.01, applyTheme)
  ]));

  // ── Sidebar badge ──────────────────────────────────────────────────────
  section.appendChild(_subgroup('Sidebar badge', [
    _number('BG saturation',     SIDEBAR_BADGE, 'BG_SATURATION',     0, 100, 5, applyTheme),
    _number('BG lightness',      SIDEBAR_BADGE, 'BG_LIGHTNESS',      0, 100, 5, applyTheme),
    _number('Text saturation',   SIDEBAR_BADGE, 'TEXT_SATURATION',   0, 100, 5, applyTheme),
    _number('Text lightness',    SIDEBAR_BADGE, 'TEXT_LIGHTNESS',    0, 100, 5, applyTheme),
    _number('Border saturation', SIDEBAR_BADGE, 'BORDER_SATURATION', 0, 100, 5, applyTheme),
    _number('Border lightness',  SIDEBAR_BADGE, 'BORDER_LIGHTNESS',  0, 100, 5, applyTheme)
  ]));

  // ── Misc visual feel ──────────────────────────────────────────────────
  section.appendChild(_subgroup('Misc', [
    _slider('Label flip hysteresis', LABEL_TYPOGRAPHY, 'FLIP_HYSTERESIS', 0, 0.5, 0.01, applyTheme)
  ]));

  return section;
}


// ─── Advanced (rebuild-required) ───────────────────────────────────────────
function _buildAdvancedSection() {
  var section = document.createElement('div');
  section.className = 'controls-section';

  var label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = 'Advanced';
  section.appendChild(label);

  var hint = document.createElement('div');
  hint.className = 'controls-section-hint';
  hint.textContent =
    'Rebuild-required knobs — changes here need a scene rebuild before ' +
    'they take effect. Edit values, then click Apply & Reload at the bottom.';
  section.appendChild(hint);

  // Advanced widgets just mutate stores — persistence captures them; the
  // Apply & Reload button at the bottom flushes them via location.reload().
  var noop = function () {};

  // ── Layout ─────────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Layout', [
    _number('Child gap',           LAYOUT_GAPS, 'CHILD_GAP',        0, 50, 1, noop),
    _number('Building–street gap', LAYOUT_GAPS, 'BLDG_STREET_GAP',  0, 50, 1, noop),
    _number('Path width',          LAYOUT_GAPS, 'PATH_WIDTH',       0, 20, 1, noop),
    _number('Root end pad',        LAYOUT_GAPS, 'ROOT_END_PAD',     0, 50, 1, noop),
    _number('Parent join pad',     LAYOUT_GAPS, 'PARENT_JOIN_PAD',  0, 20, 1, noop)
  ]));

  // ── Building dimensions ────────────────────────────────────────────────
  section.appendChild(_subgroup('Building dimensions', [
    _number('Min floors',         BUILDING_DIMENSIONS, 'MIN_FLOORS',         1, 50, 1, noop),
    _number('Max floors',         BUILDING_DIMENSIONS, 'MAX_FLOORS',         1, 200, 1, noop),
    _number('Floor height',       BUILDING_DIMENSIONS, 'FLOOR_HEIGHT',       1, 50, 1, noop),
    _number('Min width',          BUILDING_DIMENSIONS, 'MIN_WIDTH',          1, 100, 1, noop),
    _number('Max width',          BUILDING_DIMENSIONS, 'MAX_WIDTH',          1, 200, 1, noop),
    // Surface SIZE_CEILING_BYTES in MB units — way more legible than
    // raw bytes (10 MB vs 10485760).
    _scaledNumber('Size ceiling (MB)', BUILDING_DIMENSIONS, 'SIZE_CEILING_BYTES', BYTES_PER_MB, 1, 1024, 1, noop)
  ]));

  // ── Building palette HSL ranges + fallback colors ──────────────────────
  // (Hue-extension map is a structured object — edit src/config/building.js
  // directly for now; a tier editor would be a separate UI feature.)
  section.appendChild(_subgroup('Building palette', [
    _number('Saturation min',  BUILDING_PALETTE, 'SATURATION_MIN',  0, 100, 5, noop),
    _number('Saturation max',  BUILDING_PALETTE, 'SATURATION_MAX',  0, 100, 5, noop),
    _number('Lightness min',   BUILDING_PALETTE, 'LIGHTNESS_MIN',   0, 100, 5, noop),
    _number('Lightness max',   BUILDING_PALETTE, 'LIGHTNESS_MAX',   0, 100, 5, noop),
    _color ('Fallback color',  BUILDING_PALETTE, 'FALLBACK_COLOR',  noop),
    _color ('Directory color', BUILDING_PALETTE, 'DIRECTORY_COLOR', noop)
  ]));

  // ── Label typography ───────────────────────────────────────────────────
  section.appendChild(_subgroup('Label typography', [
    _color ('Fill',           LABEL_TYPOGRAPHY, 'FILL',              noop),
    _number('Font size px',   LABEL_TYPOGRAPHY, 'FONT_SIZE_PX',      32, 512, 8, noop),
    _number('Padding px',     LABEL_TYPOGRAPHY, 'CANVAS_PADDING_PX', 0, 200, 4, noop),
    _number('Stroke width',   LABEL_TYPOGRAPHY, 'STROKE_WIDTH_PX',   0, 100, 1, noop),
    _slider('Height frac',    LABEL_TYPOGRAPHY, 'HEIGHT_FRAC',       0, 2, 0.05, noop),
    _slider('Spacing mult',   LABEL_TYPOGRAPHY, 'SPACING_MULT',      0.5, 10, 0.1, noop),
    _number('Spacing floor',  LABEL_TYPOGRAPHY, 'SPACING_FLOOR',     0, 1000, 10, noop),
    _slider('Elevation',      LABEL_TYPOGRAPHY, 'ELEVATION',         0, 5, 0.1, noop)
  ]));

  // ── Asphalt geometry ───────────────────────────────────────────────────
  // (COLOR is in the Theme tab; these geometry knobs are rebuild-required.)
  section.appendChild(_subgroup('Asphalt geometry', [
    _slider('Width frac',       ASPHALT, 'WIDTH_FRAC',       0.1, 1, 0.05, noop),
    _slider('Length min frac',  ASPHALT, 'LENGTH_MIN_FRAC',  0,   1, 0.05, noop),
    _number('Stadium segments', ASPHALT, 'STADIUM_SEGMENTS', 4,  64, 1,    noop)
  ]));

  // ── Gem sizing (re-layout because layout reserves clearance) ───────────
  section.appendChild(_subgroup('Gem sizing', [
    _slider('Radius / street',    GEM_SIZING, 'RADIUS_AS_STREET_FRAC', 0.05, 1, 0.05, noop),
    _number('Min radius',         GEM_SIZING, 'MIN_RADIUS',            1, 50, 1, noop),
    _slider('Hover lift frac',    GEM_SIZING, 'HOVER_LIFT_FRAC',       0, 2, 0.05, noop),
    _number('Building clearance', GEM_SIZING, 'BUILDING_CLEARANCE',    0, 100, 1, noop)
  ]));

  // ── Camera ─────────────────────────────────────────────────────────────
  section.appendChild(_subgroup('Camera', [
    _number('FOV',                  CAMERA_PERSPECTIVE, 'FOV',                  10, 120, 1, noop),
    _number('Near',                 CAMERA_PERSPECTIVE, 'NEAR',                 0.1, 100, 0.1, noop),
    _number('Far',                  CAMERA_PERSPECTIVE, 'FAR',                  1000, 100000, 1000, noop),
    _slider('Damping',              CAMERA_CONTROLS,    'DAMPING_FACTOR',       0, 1, 0.01, noop),
    _slider('Max polar frac',       CAMERA_CONTROLS,    'MAX_POLAR_ANGLE_FRAC', 0, 0.5, 0.01, noop),
    _number('Min distance',         CAMERA_CONTROLS,    'MIN_DISTANCE',         1, 1000, 1, noop),
    _slider('Initial dist mult',    CAMERA_CONTROLS,    'INITIAL_DISTANCE_MULT', 0.1, 3, 0.05, noop),
    _number('Recenter ms',          CAMERA_ANIMATION,   'RECENTER_DURATION_MS',           50, 2000, 50, noop),
    _number('Reset ms',             CAMERA_ANIMATION,   'RESET_DURATION_MS',              50, 2000, 50, noop),
    _number('Building focus ms',    CAMERA_ANIMATION,   'BUILDING_FOCUS_DURATION_MS',     50, 2000, 50, noop),
    _number('Street focus ms',      CAMERA_ANIMATION,   'STREET_FOCUS_DURATION_MS',       50, 2000, 50, noop),
    _slider('Street view length',   CAMERA_ANIMATION,   'STREET_FOCUS_LENGTH_FRAC',  0.1, 1.5, 0.05, noop),
    _number('Street view width ×',  CAMERA_ANIMATION,   'STREET_FOCUS_WIDTH_MULT',  1, 20, 1, noop),
    _number('Street elevation deg', CAMERA_ANIMATION,   'STREET_FOCUS_ELEVATION_DEG', 30, 89, 1, noop)
  ]));

  // ── Action buttons ─────────────────────────────────────────────────────
  var actions = document.createElement('div');
  actions.className = 'controls-actions';

  var applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'controls-button';
  applyBtn.textContent = 'Apply & Reload';
  applyBtn.title = 'Reload the page so rebuild-required changes take effect. Your tweaks persist.';
  applyBtn.addEventListener('click', function () {
    if (typeof location !== 'undefined') location.reload();
  });
  actions.appendChild(applyBtn);

  var resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'controls-button controls-button-secondary';
  resetBtn.textContent = 'Reset to Defaults';
  resetBtn.title = 'Wipe all theme + advanced overrides and reload.';
  resetBtn.addEventListener('click', function () {
    if (!confirm('Reset every Theme + Advanced override and reload?')) return;
    clearPersistence();
    if (typeof location !== 'undefined') location.reload();
  });
  actions.appendChild(resetBtn);

  section.appendChild(actions);
  return section;
}


// ─── Widget builders ───────────────────────────────────────────────────────
// Each widget reads its initial value via store.get(), writes back via
// .setKey() (map) or .set() (atom), then calls onChange — applyTheme for
// Theme rows, noop for Advanced rows (the change persists, takes effect
// on next reload).

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

function _row(labelText, control) {
  var row = document.createElement('label');
  row.className = 'theme-row';
  var span = document.createElement('span');
  span.className = 'theme-row-label';
  span.textContent = labelText;
  row.appendChild(span);
  var ctrlWrap = document.createElement('span');
  ctrlWrap.className = 'theme-row-control';
  ctrlWrap.appendChild(control);
  row.appendChild(ctrlWrap);
  return row;
}

function _color(label, store, key, onChange) {
  var input = document.createElement('input');
  input.type = 'color';
  input.className = 'theme-color';
  input.value = _toHexInputValue(store.get()[key]);
  input.addEventListener('input', function () {
    store.setKey(key, input.value);
    onChange();
  });
  return _row(label, input);
}

function _number(label, store, key, min, max, step, onChange) {
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
  return _row(label, input);
}

function _slider(label, store, key, min, max, step, onChange) {
  return _sliderWidget(label, store.get()[key], min, max, step, function (v) {
    store.setKey(key, v);
    onChange();
  });
}

// _scaledNumber — for stored values whose raw unit is hostile (e.g. bytes).
// The widget displays + edits in DISPLAY_UNIT (e.g. MB) and converts to/from
// the stored unit via `unit` (e.g. 1024*1024 for MB→bytes).
function _scaledNumber(label, store, key, unit, min, max, step, onChange) {
  var input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(store.get()[key] / unit);
  input.className = 'theme-number';
  input.addEventListener('input', function () {
    var v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    store.setKey(key, Math.round(v * unit));
    onChange();
  });
  return _row(label, input);
}

// Shared slider+readout DOM construction.
function _sliderWidget(label, initialValue, min, max, step, onCommit) {
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
  readout.textContent = _formatNumber(initialValue);

  range.addEventListener('input', function () {
    var v = parseFloat(range.value);
    if (!Number.isFinite(v)) return;
    readout.textContent = _formatNumber(v);
    onCommit(v);
  });

  wrap.appendChild(range);
  wrap.appendChild(readout);
  return _row(label, wrap);
}

// Color <input type="color"> only accepts #RRGGBB. Convert from any CSS
// color string (rgba, named, etc.) to that form by round-tripping through
// a temporary DOM element so the browser does the parsing for us.
function _toHexInputValue(cssColor) {
  if (typeof cssColor !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(cssColor)) return cssColor.toLowerCase();
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

function _formatNumber(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  if (Math.abs(v) >= 1)   return v.toFixed(2);
  return v.toFixed(3);
}

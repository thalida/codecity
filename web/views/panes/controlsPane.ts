// views/panes/controlsPane.js — "Controls" tab in the left sidebar.
//
// Layout:
//   .controls-pane (flex column)
//     .controls-header   — title
//     .controls-body     — scrollable column of sections (one per scene element)
//     .controls-actions  — sticky bottom bar: "Reset all"
//
// Per-row affordance: a reset icon appears in the row's control area
// ONLY when the value differs from its default; click resets that
// key (and removes its localStorage entry). Every row is hot-reloadable —
// changes flow through config/hotReload.js, which dispatches each
// store mutation to either applyTheme() (live material refresh) or
// cityScene.applyManifest() (debounced re-layout + re-render).

import {
  // Background
  SCENE_COLORS,
  // Streets
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  PATH_LINE,
  HOVER_PATH_LINE,
  STREET_LAYOUT,
  STREET_TIERS,
  // Buildings
  BUILDING_DIMENSIONS,
  BUILDING_PALETTE,
  BUILDING_OUTLINE,
  BUILDING_FADE,
  // Gem
  GEM_SIZING,
  GEM_APPEARANCE,
  GEM_ANIMATION,
  // Effects
  RAINBOW,
  // Live updates
  LIVE_UPDATES,
  SCAN_FILTERS,
} from '@/config/index.js';
import {
  clearPersistence,
  getDefault,
  resetKey,
  hasAnyOverrides,
  onAnyChange,
} from '@/config/persist.js';
import { KEY_BINDINGS } from '@/constants';
import { FadeDetail } from '@/types';
import { makeLucideIcon } from '@/views/shell/icon.js';

// Structural store shape used by all the widget builders. Covers nanostores
// `map<T>()` (with .setKey) and falls back to .set for atom-like stores.
// Typed `any` payload because each widget binds to a different store shape;
// runtime behavior reads/writes via this minimal interface.
interface MapLikeStore {
  get(): any;
  set?(value: any): void;
  setKey?(key: string, value: any): void;
  subscribe(listener: (state: any) => void): () => void;
}

interface ControlOpts {
  tip?: string;
  onChange?: () => void;
  previewHue?: boolean;
}

interface ShortcutItem {
  kbd?: string[];
  mouse?: string;
  action: string;
  or?: string;
}

interface SelectOption {
  value: string;
  label: string;
}

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
interface BuildControlsPaneOpts {
  applyTheme?: () => void;
  onClose?: () => void;
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export function buildControlsPane(opts: BuildControlsPaneOpts = {}): HTMLElement {
  const applyTheme = opts.applyTheme ?? (() => {});

  const pane = document.createElement('div');
  pane.className = 'left-pane controls-pane';

  const header = document.createElement('div');
  header.className = 'controls-header pane-header';
  const title = document.createElement('h3');
  title.className = 'controls-title';
  title.textContent = 'Controls';
  header.appendChild(title);
  if (typeof opts.onClose === 'function') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pane-header-close';
    closeBtn.title = 'Hide sidebar';
    closeBtn.setAttribute('aria-label', 'Hide sidebar');
    closeBtn.appendChild(makeLucideIcon('x'));
    closeBtn.addEventListener('click', () => {
      opts.onClose();
    });
    header.appendChild(closeBtn);
  }
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'controls-body';

  // Sections are organized by what the user is *looking at* (background,
  // streets, buildings, gem) plus shared visual effects. Camera lens /
  // orbit / animation timings and input-feel knobs (hover commit, click
  // thresholds, tooltip placement) intentionally aren't surfaced — they're
  // designer-level constants that already have natural in-scene controls
  // (mouse to orbit, kbd to reset). See View > shortcuts list.
  body.appendChild(_buildViewSection());
  body.appendChild(_buildUpdatesSection());
  body.appendChild(_buildBackgroundSection(applyTheme));
  body.appendChild(_buildStreetsSection(applyTheme));
  body.appendChild(_buildBuildingsSection(applyTheme));
  body.appendChild(_buildGemSection(applyTheme));
  body.appendChild(_buildEffectsSection(applyTheme));
  if (
    typeof opts.onRunCollisionCheck === 'function' ||
    typeof opts.onRunStemDiagnostic === 'function'
  ) {
    body.appendChild(
      _buildDebugSection(opts.onRunCollisionCheck, opts.onRunStemDiagnostic),
    );
  }

  pane.appendChild(body);
  pane.appendChild(_buildActionsSection()); // sticky bottom — sibling of body
  return pane;
}

// ─── Scan ──────────────────────────────────────────────────────────────────
// What the scanner picks up + when to re-scan. SHOW_ALL_FILES bypasses
// the tracked-files-only filter (default OFF — current behavior); live
// updates polls /api/manifest/signature on a clamped [1s, 60s] interval
// so an over-eager value can't ddos the local server.
function _buildUpdatesSection(): HTMLElement {
  const section = _section(
    'Scan',
    'What the scanner picks up, and how it stays in sync.'
  );
  section.appendChild(
    _subgroup('Filters', [
      _toggle('Show all files', SCAN_FILTERS, 'SHOW_ALL_FILES', {
        tip: 'When on, untracked and gitignored files (node_modules/, build artifacts, drafts) are included. No effect outside a git repo. Toggling re-fetches the manifest.',
      }),
    ])
  );
  section.appendChild(
    _subgroup('Live updates', [
      _toggle('Enabled', LIVE_UPDATES, 'ENABLED', {
        tip: "When on, the city re-renders in place every poll interval if the scanned tree's mtime/size signature changed.",
      }),
      _number('Poll interval (s)', LIVE_UPDATES, 'POLL_SECONDS', 1, 60, 1, {
        tip: 'How often to re-fetch the manifest. Lower = snappier; higher = lighter on the local server.',
      }),
    ])
  );
  return section;
}

// ─── View ──────────────────────────────────────────────────────────────────
// No "Reset camera" button — the R key already covers that, and surfacing
// the full shortcut list as a table makes the rest of the controls
// (orbit / pan / zoom / focus / select) discoverable too.
function _buildViewSection(): HTMLElement {
  const section = _section(
    'View',
    'Pivot follows what you point at. The selected building stays solid; everything else fades by directory-tree distance from the selection.'
  );

  section.appendChild(
    _buildShortcutsList([
      { kbd: [KEY_BINDINGS.RESET_VIEW.label], action: 'Reset the camera framing' },
      { kbd: [KEY_BINDINGS.FOCUS_SELECTION.label], action: 'Focus camera on the current selection' },
      { kbd: [KEY_BINDINGS.CLEAR_SELECTION.label], action: 'Close the sidebar / clear selection' },
      null, // section break
      { mouse: 'Left drag', action: 'Orbit' },
      { mouse: 'Right drag', action: 'Pan' },
      { mouse: 'Middle drag', action: 'Dolly (zoom)' },
      { mouse: 'Scroll', action: 'Zoom toward cursor' },
      null,
      { mouse: 'Click', action: 'Select building / street / gem' },
      { mouse: 'Double-click', action: 'Focus camera on the target' },
    ])
  );

  return section;
}

function _buildShortcutsList(items: Array<ShortcutItem | null>): HTMLDListElement {
  const dl = document.createElement('dl');
  dl.className = 'shortcuts-list';
  for (const item of items) {
    if (item == null) {
      const divider = document.createElement('div');
      divider.className = 'shortcuts-divider';
      dl.appendChild(divider);
      continue;
    }
    const dt = document.createElement('dt');
    if (item.kbd) {
      item.kbd.forEach((label, k) => {
        if (k > 0) dt.appendChild(document.createTextNode(' '));
        const key = document.createElement('kbd');
        key.textContent = label;
        dt.appendChild(key);
      });
      if (item.or) {
        const or = document.createElement('span');
        or.className = 'shortcuts-or';
        or.textContent = ` ${item.or}`;
        dt.appendChild(or);
      }
    } else if (item.mouse) {
      const ms = document.createElement('span');
      ms.className = 'shortcuts-mouse';
      ms.textContent = item.mouse;
      dt.appendChild(ms);
    }
    const dd = document.createElement('dd');
    dd.textContent = item.action;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  return dl;
}

// ─── Background ────────────────────────────────────────────────────────────
function _buildBackgroundSection(applyTheme: () => void): HTMLElement {
  const section = _section('Background', 'The void behind everything.');
  section.appendChild(
    _color('Sky / ground', SCENE_COLORS, 'GROUND', {
      tip: 'Color shown behind buildings + streets. Live.',
      onChange: applyTheme,
    })
  );
  return section;
}

// ─── Streets ───────────────────────────────────────────────────────────────
function _buildStreetsSection(applyTheme: () => void): HTMLElement {
  const section = _section(
    'Streets',
    'Asphalt, sidewalks, street labels, and the neon path that highlights the route from the root gem to the selected file.'
  );

  // Asphalt — color only. Width is a designer-level geometry knob; length
  // is derived to keep the cap circles concentric.
  section.appendChild(
    _subgroup('Asphalt', [
      _color('Color', ASPHALT, 'COLOR', {
        tip: 'Color of the inner road stripe. Live.',
        onChange: applyTheme,
      }),
    ])
  );

  // Sidewalks. (No "Path" tint — the lineage from gem→selection is shown
  // by the rainbow neon line alone, see "Selection path line" below.)
  section.appendChild(
    _subgroup('Sidewalk colors', [
      _color('Default', SIDEWALK_COLORS, 'DEFAULT', {
        tip: 'Resting tint on every sidewalk.',
        onChange: applyTheme,
      }),
      _color('Hover', SIDEWALK_COLORS, 'HOVER', {
        tip: 'When the cursor is over a street.',
        onChange: applyTheme,
      }),
      _color('Selected', SIDEWALK_COLORS, 'SELECTED', {
        tip: 'When a street (directory) is selected.',
        onChange: applyTheme,
      }),
    ])
  );

  // Street labels
  section.appendChild(
    _subgroup('Street labels', [
      _color('Fill', LABEL_TYPOGRAPHY, 'FILL', {
        tip: 'Text color of the names painted on each road. Live (label textures regenerate on the fly when this changes).',
        onChange: applyTheme,
      }),
      _slider('Camera-flip dead zone', LABEL_TYPOGRAPHY, 'FLIP_HYSTERESIS', 0, 0.5, 0.01, {
        tip: 'How far the camera must rotate before labels flip 180° to stay readable. Higher = less flicker, more time spent reading upside-down.',
        onChange: applyTheme,
      }),
      _number('Font size (px)', LABEL_TYPOGRAPHY, 'FONT_SIZE_PX', 32, 512, 8, {
        tip: 'Source canvas font size. Higher = sharper close-zoom, larger texture memory.',
      }),
      _number('Padding (px)', LABEL_TYPOGRAPHY, 'CANVAS_PADDING_PX', 0, 200, 4, {
        tip: 'Whitespace around each label inside its texture canvas.',
      }),
      _number('Stroke width (px)', LABEL_TYPOGRAPHY, 'STROKE_WIDTH_PX', 0, 100, 1, {
        tip: 'Thickness of the dark outline behind the label fill.',
      }),
      _slider('Height × street width', LABEL_TYPOGRAPHY, 'HEIGHT_FRAC', 0, 2, 0.05, {
        tip: 'Label plane height in world units, as a fraction of the street width. Wider streets get bigger labels.',
        onChange: applyTheme,
      }),
      _slider('Repeat × label width', LABEL_TYPOGRAPHY, 'SPACING_MULT', 0.5, 10, 0.1, {
        tip: 'Distance between label repeats along a long street, expressed as a multiple of the label width.',
      }),
      _number('Repeat floor', LABEL_TYPOGRAPHY, 'SPACING_FLOOR', 0, 1000, 10, {
        tip: 'Minimum repeat distance in world units (so tiny labels do not pile up).',
      }),
    ])
  );

  // Selection path line — the neon line tracing gem → current selection
  // through the road network. Color cycle is shared with the building
  // outline; tweak Effects > Rainbow.
  section.appendChild(
    _subgroup('Selection path line', [
      _number('Linewidth', PATH_LINE, 'LINEWIDTH', 1, 20, 1, {
        tip: 'Pixel thickness of the rainbow line.',
        onChange: applyTheme,
      }),
      _slider('Opacity', PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Path-line transparency. 0 = invisible; 1 = solid.',
        onChange: applyTheme,
      }),
    ])
  );

  // Hover preview path line — the faded "what would happen if I clicked"
  // version of the selection line, drawn while the cursor is over a
  // building or street. Suppressed when the hovered target IS the
  // current selection (would just overlap the rainbow line).
  section.appendChild(
    _subgroup('Hover preview path line', [
      _toggle('Enabled', HOVER_PATH_LINE, 'ENABLED', {
        tip: 'Show a draft preview line from the gem to whatever the cursor is currently over.',
        onChange: applyTheme,
      }),
      _color('Color', HOVER_PATH_LINE, 'COLOR', {
        tip: 'Solid color of the preview line. Faded white by default so it reads as a draft, not the committed rainbow line.',
        onChange: applyTheme,
      }),
      _number('Linewidth', HOVER_PATH_LINE, 'LINEWIDTH', 1, 20, 1, {
        tip: 'Pixel thickness of the preview line.',
        onChange: applyTheme,
      }),
      _slider('Opacity', HOVER_PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Preview-line transparency. 0 = invisible; 1 = solid.',
        onChange: applyTheme,
      }),
    ])
  );

  // Width tiers — step-function mapping a directory's descendant count to
  // its street width. One slider per tier so the user can fatten or thin
  // any specific road class without touching the others. min_descendants
  // thresholds aren't user-tunable (would shuffle the whole layout); only
  // the world-unit width per tier.
  const tierDefaults = STREET_TIERS.get();
  const tierRows = tierDefaults.map((tier, ti) => _tierWidthSlider(ti, tier.min_descendants));
  section.appendChild(_subgroup('Width tiers', tierRows));

  // Layout
  section.appendChild(
    _subgroup('Layout', [
      _number('Sibling gap', STREET_LAYOUT, 'CHILD_GAP', 0, 50, 1, {
        tip: 'Distance between sibling children (file or subdir) packed along a street.',
      }),
      _number('Root end pad', STREET_LAYOUT, 'ROOT_END_PAD', 0, 50, 1, {
        tip: 'Fallback pad at each end of the root street (which has no parent intersection).',
      }),
      _number('Parent join pad', STREET_LAYOUT, 'PARENT_JOIN_PAD', 0, 20, 1, {
        tip: 'Extra clear space where a child street meets its parent.',
      }),
    ])
  );

  return section;
}

// ─── Buildings ─────────────────────────────────────────────────────────────
function _buildBuildingsSection(applyTheme: () => void): HTMLElement {
  const section = _section(
    'Buildings',
    'Per-file boxes — height from line count, width from byte size, color from extension + age.'
  );

  section.appendChild(
    _subgroup('Size', [
      _rangePair('Floors range', BUILDING_DIMENSIONS, 'MIN_FLOORS', 'MAX_FLOORS', 1, 200, 1, {
        tip: "How tall a building gets — represents the file's line count. Smallest file in the project lands at MIN floors; largest at MAX. Sqrt-interpolated across line counts.",
      }),
      _number('Floor height', BUILDING_DIMENSIONS, 'FLOOR_HEIGHT', 1, 50, 1, {
        tip: 'Vertical world units per floor (multiplier on the floor count above).',
      }),
      _rangePair('Width range', BUILDING_DIMENSIONS, 'MIN_WIDTH', 'MAX_WIDTH', 1, 200, 1, {
        tip: "How wide a building's footprint is — represents the file's byte size. Smallest file lands at MIN width; largest at MAX. Log-interpolated across byte sizes. Footprints are square (depth = width).",
      }),
      _number('Building path length', BUILDING_DIMENSIONS, 'PATH_LENGTH', 0, 50, 1, {
        tip: "Distance from the building's wall to the adjacent sidewalk. The path connector strip bridges this gap.",
      }),
      _slider('Building path width', BUILDING_DIMENSIONS, 'PATH_WIDTH_FRAC', 0, 1, 0.05, {
        tip: "Width of the path connector strip, as a fraction of the building's own width — so big buildings get proportionally wider paths. Door is sized to ~80% of this same per-building path width.",
      }),
    ])
  );

  section.appendChild(
    _subgroup('Color palette (HSL)', [
      _rangePair(
        'Saturation range',
        BUILDING_PALETTE,
        'SATURATION_MIN',
        'SATURATION_MAX',
        0,
        100,
        5,
        {
          tip: 'HSL saturation range — older files tend to MIN, newly-created tend to MAX.',
        }
      ),
      _rangePair('Lightness range', BUILDING_PALETTE, 'LIGHTNESS_MIN', 'LIGHTNESS_MAX', 0, 100, 5, {
        tip: 'HSL lightness range — recently-modified files tend to MAX (brighter); stale files tend to MIN.',
      }),
      _color('Directory color', BUILDING_PALETTE, 'DIRECTORY_COLOR', {
        tip: 'Solid color for any building representing a directory rather than a file.',
      }),
    ])
  );

  // Extension hues — one row per file extension in HUE_EXT_MAP, sorted
  // alphabetically so the list stays predictable. Each row writes back
  // to a single sub-key of HUE_EXT_MAP (no whole-map clobber).
  const huePaletteRows = [];
  const hueDefaults = getDefault(BUILDING_PALETTE, 'HUE_EXT_MAP') || {};
  const hueExtensions = Object.keys(hueDefaults).sort();
  for (const ext of hueExtensions) {
    huePaletteRows.push(
      _nestedSlider(ext, BUILDING_PALETTE, 'HUE_EXT_MAP', ext, 0, 359, 1, {
        tip: 'Hue (0–359°) for files with this extension.',

        previewHue: true,
      })
    );
  }
  section.appendChild(_subgroup('Extension hues (0–359°)', huePaletteRows));

  section.appendChild(
    _subgroup('Outlines', [
      _number('Linewidth', BUILDING_OUTLINE, 'WIDTH', 1, 10, 1, {
        tip: 'Pixel thickness shared by per-building, hover, and selected outlines.',
        onChange: applyTheme,
      }),
      _color('Hover color', BUILDING_OUTLINE, 'HOVER_COLOR', {
        tip: 'Outline color when the cursor is over a building.',
        onChange: applyTheme,
      }),
      _slider('Hover opacity', BUILDING_OUTLINE, 'HOVER_OPACITY', 0, 1, 0.05, {
        onChange: applyTheme,
      }),
      _slider('Selected opacity', BUILDING_OUTLINE, 'SELECTED_OPACITY', 0, 1, 0.05, {
        tip: 'Selected outline uses an animated rainbow color — see Effects > Rainbow.',
        onChange: applyTheme,
      }),
    ])
  );

  // Selection fade — animation knobs first, then per-tier style. Each tier
  // (Default = siblings of selection / Level 1 = one hop / Level 2+ = far)
  // gets four controls: detail (full / silhouette / hidden), outline on/off,
  // and separate body + outline opacity sliders. Hover renders a building
  // using the Default tier's settings — no separate hover-floor knob.
  section.appendChild(
    _subgroup('Selection fade — animation', [
      _slider('Fade speed', BUILDING_FADE, 'LERP_SPEED', 0.01, 1.0, 0.01, {
        tip: 'Per-frame easing toward the target opacity. Higher = snappier transitions.',
        onChange: applyTheme,
      }),
    ])
  );

  const DETAIL_OPTIONS = [
    { value: FadeDetail.Full, label: 'Full' },
    { value: FadeDetail.Silhouette, label: 'Silhouette' },
    { value: FadeDetail.Hidden, label: 'Hidden' },
  ];

  section.appendChild(
    _subgroup('Default — siblings of selection', [
      _select('Detail', BUILDING_FADE, 'DEFAULT_DETAIL', DETAIL_OPTIONS, {
        tip: 'Full = textured walls + windows + doors. Silhouette = solid-color box. Hidden = body invisible (only outline can show).',
        onChange: applyTheme,
      }),
      _toggle('Outline', BUILDING_FADE, 'DEFAULT_OUTLINE', {
        tip: 'Show the wireframe edge overlay.',
        onChange: applyTheme,
      }),
      _slider('Body opacity', BUILDING_FADE, 'DEFAULT_BODY_OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Opacity for the body / silhouette layer.',
        onChange: applyTheme,
      }),
      _slider('Outline opacity', BUILDING_FADE, 'DEFAULT_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Opacity for the wireframe outline layer (only visible if Outline is on).',
        onChange: applyTheme,
      }),
    ])
  );

  section.appendChild(
    _subgroup('Level 1 — one hop from selection', [
      _select('Detail', BUILDING_FADE, 'NEAR_DETAIL', DETAIL_OPTIONS, { onChange: applyTheme }),
      _toggle('Outline', BUILDING_FADE, 'NEAR_OUTLINE', { onChange: applyTheme }),
      _slider('Body opacity', BUILDING_FADE, 'NEAR_BODY_OPACITY', 0.0, 1.0, 0.05, {
        onChange: applyTheme,
      }),
      _slider('Outline opacity', BUILDING_FADE, 'NEAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {
        onChange: applyTheme,
      }),
    ])
  );

  section.appendChild(
    _subgroup('Level 2+ — cousins, deeper subtrees', [
      _select('Detail', BUILDING_FADE, 'FAR_DETAIL', DETAIL_OPTIONS, { onChange: applyTheme }),
      _toggle('Outline', BUILDING_FADE, 'FAR_OUTLINE', { onChange: applyTheme }),
      _slider('Body opacity', BUILDING_FADE, 'FAR_BODY_OPACITY', 0.0, 1.0, 0.05, {
        onChange: applyTheme,
      }),
      _slider('Outline opacity', BUILDING_FADE, 'FAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {
        onChange: applyTheme,
      }),
    ])
  );

  return section;
}

// ─── Gem ───────────────────────────────────────────────────────────────────
function _buildGemSection(applyTheme: () => void): HTMLElement {
  const section = _section('Root gem', 'The floating spinning octahedron above the root street.');

  section.appendChild(
    _subgroup('Sizing + plaza', [
      _slider('Radius × street width', GEM_SIZING, 'RADIUS_AS_STREET_FRAC', 0.05, 1, 0.05, {
        tip: 'Gem radius relative to the root street width. Bigger gems demand more empty plaza space.',
      }),
      _number('Min radius', GEM_SIZING, 'MIN_RADIUS', 1, 50, 1, {
        tip: 'Floor for narrow root streets so the gem stays visible.',
      }),
      _slider('Hover lift × street width', GEM_SIZING, 'HOVER_LIFT_FRAC', 0, 2, 0.05, {
        tip: 'Extra vertical lift above the road, on top of the gem radius.',
        onChange: applyTheme,
      }),
      _number('Plaza clearance', GEM_SIZING, 'BUILDING_CLEARANCE', 0, 100, 1, {
        tip: "Dead-space pad past the gem at the root street's origin end.",
      }),
    ])
  );

  section.appendChild(
    _subgroup('Appearance', [
      _color('Edge color', GEM_APPEARANCE, 'EDGE_COLOR', {
        tip: 'Neutral separator line drawn around each gem face.',
        onChange: applyTheme,
      }),
      _slider('Body opacity', GEM_APPEARANCE, 'BODY_OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Gem transparency. Low = jewel-like; high = plastic.',
        onChange: applyTheme,
      }),
    ])
  );

  section.appendChild(
    _subgroup('Animation', [
      _slider('Rotation speed', GEM_ANIMATION, 'ROTATION_SPEED', 0, 3, 0.05, {
        onChange: applyTheme,
      }),
      _slider('Bob frequency', GEM_ANIMATION, 'BOB_FREQUENCY', 0, 5, 0.1, {
        tip: 'How fast the gem oscillates vertically.',
        onChange: applyTheme,
      }),
      _slider('Bob amplitude', GEM_ANIMATION, 'BOB_AMPLITUDE_FRAC', 0, 2, 0.05, {
        tip: 'Vertical bob distance, as a fraction of the gem radius.',
        onChange: applyTheme,
      }),
      _slider('Hover scale', GEM_ANIMATION, 'HOVER_SCALE', 1, 3, 0.05, {
        tip: 'Multiplier applied to the gem when the cursor is over it.',
        onChange: applyTheme,
      }),
      _slider('Hover lerp', GEM_ANIMATION, 'SCALE_LERP_SPEED', 0.01, 1, 0.01, {
        tip: 'Per-frame ease toward the hover scale.',
        onChange: applyTheme,
      }),
    ])
  );

  return section;
}

// ─── Effects ───────────────────────────────────────────────────────────────
function _buildEffectsSection(applyTheme: () => void): HTMLElement {
  const section = _section('Effects', 'Shared visual effects.');

  section.appendChild(
    _subgroup('Rainbow (selected outline + path line)', [
      _slider('Speed', RAINBOW, 'SPEED', 0, 0.005, 0.0001, {
        tip: 'Hue cycles per millisecond. The shared rainbow chases around the selected building outline AND the gem→selection path line.',
        onChange: applyTheme,
      }),
      _slider('Saturation', RAINBOW, 'SATURATION', 0, 1, 0.05, { onChange: applyTheme }),
      _slider('Lightness', RAINBOW, 'LIGHTNESS', 0, 1, 0.05, { onChange: applyTheme }),
    ])
  );

  return section;
}

// ─── Debug ─────────────────────────────────────────────────────────────────
// Developer-only diagnostics. Collapsed by default so the section doesn't
// distract during normal use. Buttons are rendered only when their callback
// is provided; either or both may be present.
function _buildDebugSection(
  onRunCollisionCheck: (() => void) | undefined,
  onRunStemDiagnostic: (() => void) | undefined,
): HTMLElement {
  const section = document.createElement('details');
  section.className = 'controls-section controls-section-collapsible';

  const summary = document.createElement('summary');
  summary.className = 'controls-section-label';
  summary.textContent = 'Debug';
  section.appendChild(summary);

  const hint = document.createElement('div');
  hint.className = 'controls-section-hint';
  hint.textContent =
    'Developer-only diagnostics. Output goes to the browser console.';
  section.appendChild(hint);

  if (onRunCollisionCheck) {
    const row = document.createElement('div');
    row.className = 'theme-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'controls-button';
    button.textContent = 'Run collision check';
    button.title = 'Walks the current layout and logs any rect/rect overlaps.';
    button.addEventListener('click', () => {
      onRunCollisionCheck();
    });
    row.appendChild(button);
    section.appendChild(row);
  }

  if (onRunStemDiagnostic) {
    const row = document.createElement('div');
    row.className = 'theme-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'controls-button';
    button.textContent = 'Diagnose stem placement';
    button.title =
      'Re-runs layout under tracing and logs, per road, the chosen stem and binding obstacle for each child placement.';
    button.addEventListener('click', () => {
      onRunStemDiagnostic();
    });
    row.appendChild(button);
    section.appendChild(row);
  }

  return section;
}

// ─── Sticky bottom action bar ──────────────────────────────────────────────
// "Reset all" — the global panic button. Per-row reset icons cover the
// common case. Wiping the persisted overrides triggers each store's
// hot-reload subscription, so the city snaps back to defaults without
// a page reload.
function _buildActionsSection(): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'controls-actions';

  const resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.className = 'controls-button controls-button-secondary';
  resetAll.appendChild(makeLucideIcon('rotate-ccw', { class: 'controls-button-icon' }));
  resetAll.appendChild(document.createTextNode('Reset all'));
  resetAll.title = 'Wipe every override. (Per-row reset icons restore single values.)';
  resetAll.addEventListener('click', () => {
    if (resetAll.disabled) return;
    if (!confirm('Reset every override?')) return;
    clearPersistence();
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

function _section(name: string, hint?: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'controls-section';

  const label = document.createElement('div');
  label.className = 'controls-section-label';
  label.textContent = name;
  section.appendChild(label);

  if (hint) {
    const h = document.createElement('div');
    h.className = 'controls-section-hint';
    h.textContent = hint;
    section.appendChild(h);
  }
  return section;
}

function _subgroup(name: string, rows: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'theme-subgroup';
  const h = document.createElement('div');
  h.className = 'theme-subgroup-label';
  h.textContent = name;
  wrap.appendChild(h);
  for (const row of rows) wrap.appendChild(row);
  return wrap;
}

// _row(labelText, control, store, keys, opts) -> <label>
//   store     — nanostore the control writes into; null skips the reset icon
//   keys      — array of keys this row covers (1 for single widgets, 2 for
//               rangePair). The reset icon shows when ANY key differs from
//               its registered default.
//   opts.tip      — full hover text (added to the row's title attribute)
function _row(
  labelText: string,
  control: HTMLElement,
  store: MapLikeStore | null,
  keys: string[] | null,
  opts: ControlOpts = {}
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'theme-row';

  let fullTip = labelText;
  if (opts.tip) fullTip += ` — ${opts.tip}`;
  row.title = fullTip;

  const span = document.createElement('span');
  span.className = 'theme-row-label';
  span.textContent = labelText;
  span.title = fullTip;
  row.appendChild(span);

  const ctrlWrap = document.createElement('span');
  ctrlWrap.className = 'theme-row-control';
  ctrlWrap.appendChild(control);

  if (store && keys && keys.length) {
    const resetBtn = _makeResetButton(store, keys, opts);
    ctrlWrap.appendChild(resetBtn);
  }

  row.appendChild(ctrlWrap);
  return row;
}

// _makeResetButton(store, keys, opts) -> <button>
// Visible only when at least one of `keys` differs from its registered
// default. Click resets all listed keys, removes the matching localStorage
// entries (via persist.js's resetKey), and fires opts.onChange so the
// scene/UI catches up immediately.
function _makeResetButton(
  store: MapLikeStore,
  keys: string[],
  opts: ControlOpts
): HTMLButtonElement {
  const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-row-reset';
  btn.title = _formatDefaultTooltip(store, keys);
  btn.setAttribute('aria-label', 'Reset to default');
  btn.appendChild(makeLucideIcon('rotate-ccw'));
  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    for (const k of keys) resetKey(store, k);
    onChange();
  });

  // Disabled when value matches default — keeps the icon in layout
  // (no UI bouncing) but only clickable when there's actually
  // something to reset.
  function refresh() {
    const state = store.get();
    btn.disabled = keys.every((k) => _isEqual(state[k], getDefault(store, k)));
  }
  refresh();
  store.subscribe(refresh);
  return btn;
}

// _formatDefaultTooltip(store, keys) -> "Default: <value>" / "Default: <lo> – <hi>"
// Used as the reset icon's hover title so the user can see what they'd revert
// to without clicking. Static — reads the registered default once.
function _formatDefaultTooltip(store: MapLikeStore, keys: string[] | null): string {
  if (!keys || keys.length === 0) return 'Reset to default';
  if (keys.length === 1) {
    return `Default: ${_formatDefaultValue(getDefault(store, keys[0]))}`;
  }
  // rangePair (2 keys: min, max)
  const lo = getDefault(store, keys[0]);
  const hi = getDefault(store, keys[1]);
  return `Default: ${_formatDefaultValue(lo)} – ${_formatDefaultValue(hi)}`;
}

function _formatDefaultValue(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

function _isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

// ─── Widget builders ───────────────────────────────────────────────────────

function _color(
  label: string,
  store: MapLikeStore,
  key: string,
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'theme-color';
  input.value = _toHexInputValue(store.get()[key]);
  input.addEventListener('input', () => {
    store.setKey(key, input.value);
    onChange();
  });
  // Reflect outside changes (e.g. reset-to-default) back into the input.
  store.subscribe((state) => {
    const hex = _toHexInputValue(state[key]);
    if (input.value.toLowerCase() !== hex) input.value = hex;
  });
  return _row(label, input, store, [key], opts);
}

function _number(
  label: string,
  store: MapLikeStore,
  key: string,
  min: number,
  max: number,
  step: number,
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(store.get()[key]);
  input.className = 'theme-number';
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) {
      store.setKey(key, v);
      onChange();
    }
  });
  store.subscribe((state) => {
    const s = String(state[key]);
    if (input.value !== s && document.activeElement !== input) input.value = s;
  });
  return _row(label, input, store, [key], opts);
}

function _slider(
  label: string,
  store: MapLikeStore,
  key: string,
  min: number,
  max: number,
  step: number,
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const refs = {} as SliderRefs;
  const control = _sliderWidget(
    store.get()[key],
    min,
    max,
    step,
    (v) => {
      store.setKey(key, v);
      onChange();
    },
    refs
  );
  // Reflect outside changes (reset-to-default) back into the slider + readout.
  store.subscribe((state) => {
    const v = state[key];
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
function _nestedSlider(
  label: string,
  store: MapLikeStore,
  parentKey: string,
  subKey: string,
  min: number,
  max: number,
  step: number,
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const refs = {} as SliderRefs;
  const initial = (store.get()[parentKey] || {})[subKey];

  let swatch: HTMLSpanElement | null = null;
  if (opts && opts.previewHue) {
    swatch = document.createElement('span');
    swatch.className = 'theme-hue-preview';
    swatch.style.background = `hsl(${initial}, 80%, 55%)`;
  }

  const control = _sliderWidget(
    initial,
    min,
    max,
    step,
    (v) => {
      const current = store.get()[parentKey] || {};
      const next = {};
      for (const k in current) {
        if (Object.hasOwn(current, k)) next[k] = current[k];
      }
      next[subKey] = v;
      store.setKey(parentKey, next);
      if (swatch) swatch.style.background = `hsl(${v}, 80%, 55%)`;
      onChange();
    },
    refs
  );

  store.subscribe((state) => {
    const v = (state[parentKey] || {})[subKey];
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, step);
      if (swatch) swatch.style.background = `hsl(${v}, 80%, 55%)`;
    }
  });

  // Reset icon: visible when this sub-key differs from its registered default.
  // Click resets only this sub-key.
  const rowOpts: ControlOpts = {};
  for (const ok in opts) {
    if (Object.hasOwn(opts, ok)) {
      (rowOpts as Record<string, unknown>)[ok] = (opts as Record<string, unknown>)[ok];
    }
  }

  const row = _row(label, control, null, null, rowOpts);
  const ctrlWrap = row.querySelector<HTMLElement>('.theme-row-control')!;
  if (swatch) ctrlWrap.appendChild(swatch);
  const resetBtn = _makeNestedResetButton(store, parentKey, subKey, opts);
  ctrlWrap.appendChild(resetBtn);
  return row;
}

// _tierWidthSlider — slider bound to STREET_TIERS[index].width. The atom
// holds a frozen-shape array of { min_descendants, width }; this widget
// rewrites the array with one tier's width changed, leaving the rest
// (and every other tier's min_descendants) intact. Reset goes back to
// the registered default's width for that index.
function _tierWidthSlider(index: number, minDescendants: number): HTMLLabelElement {
  const refs = {} as SliderRefs;
  const label = `${minDescendants}+ descendants`;
  const initial = (STREET_TIERS.get()[index] || {}).width;

  const control = _sliderWidget(
    initial,
    1,
    100,
    1,
    (v) => {
      const current = STREET_TIERS.get();
      const next = current.slice();
      next[index] = { min_descendants: current[index].min_descendants, width: v };
      STREET_TIERS.set(next);
    },
    refs
  );

  STREET_TIERS.subscribe((state) => {
    const v = (state[index] || {}).width;
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, 1);
    }
  });

  const rowOpts: ControlOpts = {
    tip: 'World-unit width for streets in this descendant-count tier.',
  };
  const row = _row(label, control, null, null, rowOpts);
  row
    .querySelector<HTMLElement>('.theme-row-control')!
    .appendChild(_makeTierWidthResetButton(index));
  return row;
}

function _makeTierWidthResetButton(index: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-row-reset';
  btn.setAttribute('aria-label', 'Reset to default');
  btn.appendChild(makeLucideIcon('rotate-ccw'));

  const defaultArr = getDefault(STREET_TIERS) || [];
  const defaultVal = (defaultArr[index] || {}).width;
  btn.title = `Default: ${_formatDefaultValue(defaultVal)}`;

  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const current = STREET_TIERS.get();
    const next = current.slice();
    next[index] = { min_descendants: current[index].min_descendants, width: defaultVal };
    STREET_TIERS.set(next);
  });

  function refresh() {
    const v = (STREET_TIERS.get()[index] || {}).width;
    btn.disabled = _isEqual(v, defaultVal);
  }
  refresh();
  STREET_TIERS.subscribe(refresh);
  return btn;
}

function _makeNestedResetButton(
  store: MapLikeStore,
  parentKey: string,
  subKey: string,
  opts: ControlOpts
): HTMLButtonElement {
  const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-row-reset';
  btn.setAttribute('aria-label', 'Reset to default');
  btn.appendChild(makeLucideIcon('rotate-ccw'));

  const defaultMap = getDefault(store, parentKey) || {};
  const defaultVal = defaultMap[subKey];
  btn.title = `Default: ${_formatDefaultValue(defaultVal)}`;

  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const current = store.get()[parentKey] || {};
    const next = {};
    for (const k in current) {
      if (Object.hasOwn(current, k)) next[k] = current[k];
    }
    next[subKey] = defaultVal;
    store.setKey(parentKey, next);
    onChange();
  });

  function refresh() {
    const v = (store.get()[parentKey] || {})[subKey];
    btn.disabled = _isEqual(v, defaultVal);
  }
  refresh();
  store.subscribe(refresh);
  return btn;
}

// _select — segmented radio for an enum-valued key. `options` is an array
// of { value, label }. Renders one button per option; clicking sets the
// store key. The active option has .is-active.
function _select(
  label: string,
  store: MapLikeStore,
  key: string,
  options: SelectOption[],
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const wrap = document.createElement('span');
  wrap.className = 'theme-select';

  const buttons = options.map((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-select-option';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      store.setKey(key, opt.value);
      onChange();
    });
    wrap.appendChild(btn);
    return btn;
  });

  function refresh() {
    const current = store.get()[key];
    for (const btn of buttons) {
      btn.classList.toggle('is-active', btn.dataset.value === current);
    }
  }
  refresh();
  store.subscribe(refresh);
  return _row(label, wrap, store, [key], opts);
}

// _toggle — boolean checkbox. Reflects external changes (reset-to-default).
function _toggle(
  label: string,
  store: MapLikeStore,
  key: string,
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'theme-toggle';
  input.checked = !!store.get()[key];
  input.addEventListener('change', () => {
    store.setKey(key, input.checked);
    onChange();
  });
  store.subscribe((state) => {
    const v = !!state[key];
    if (input.checked !== v) input.checked = v;
  });
  return _row(label, input, store, [key], opts);
}

function _rangePair(
  label: string,
  store: MapLikeStore,
  minKey: string,
  maxKey: string,
  lo: number,
  hi: number,
  step: number,
  opts: ControlOpts
): HTMLLabelElement {
  const onChange = _resolveChange(opts);
  const current = store.get();

  const pair = document.createElement('span');
  pair.className = 'theme-range-pair';

  const track = document.createElement('span');
  track.className = 'theme-range-pair-track';
  pair.appendChild(track);

  const fill = document.createElement('span');
  fill.className = 'theme-range-pair-fill';
  pair.appendChild(fill);

  function makeRange(value: number): HTMLInputElement {
    const r = document.createElement('input');
    r.type = 'range';
    r.min = String(lo);
    r.max = String(hi);
    r.step = String(step);
    r.value = String(value);
    return r;
  }
  const loRange = makeRange(current[minKey]);
  loRange.classList.add('theme-range-pair-lo');
  const hiRange = makeRange(current[maxKey]);
  hiRange.classList.add('theme-range-pair-hi');
  pair.appendChild(loRange);
  pair.appendChild(hiRange);

  const readout = document.createElement('span');
  readout.className = 'theme-slider-readout';

  function paint() {
    const l = parseFloat(loRange.value);
    const h = parseFloat(hiRange.value);
    const span = hi - lo || 1;
    fill.style.left = `${((l - lo) / span) * 100}%`;
    fill.style.right = `${((hi - h) / span) * 100}%`;
    readout.textContent = `${_formatNumberForStep(l, step)} – ${_formatNumberForStep(h, step)}`;
  }

  function commit() {
    let l = parseFloat(loRange.value);
    let h = parseFloat(hiRange.value);
    if (!Number.isFinite(l) || !Number.isFinite(h)) return;
    if (l > h) {
      l = h;
      loRange.value = String(l);
    }
    if (h < l) {
      h = l;
      hiRange.value = String(h);
    }
    store.setKey(minKey, l);
    store.setKey(maxKey, h);
    paint();
    onChange();
  }

  loRange.addEventListener('input', commit);
  hiRange.addEventListener('input', commit);
  paint();

  // Reflect outside changes (reset-to-default) back into both thumbs.
  store.subscribe((state) => {
    let changed = false;
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

  const wrap = document.createElement('span');
  wrap.className = 'theme-slider-wrap';
  wrap.appendChild(pair);
  wrap.appendChild(readout);
  return _row(label, wrap, store, [minKey, maxKey], opts);
}

// Shared slider+readout DOM construction. Returns the wrapper; the caller
// passes a `refs` object to receive the {range, readout} inner nodes (so
// store.subscribe can drive them on external value changes).
// Fields are typed non-optional even though they start undefined: the
// caller always passes `refs` through `_sliderWidget`, which populates
// both fields synchronously before `_sliderWidget` returns. Subscribers
// only ever read `refs` after that point.
interface SliderRefs {
  range: HTMLInputElement;
  readout: HTMLSpanElement;
}

function _sliderWidget(
  initialValue: number,
  min: number,
  max: number,
  step: number,
  onCommit: (v: number) => void,
  refs?: Partial<SliderRefs>
): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'theme-slider-wrap';

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(initialValue);
  range.className = 'theme-slider';

  const readout = document.createElement('span');
  readout.className = 'theme-slider-readout';
  readout.textContent = _formatNumberForStep(initialValue, step);

  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    if (!Number.isFinite(v)) return;
    readout.textContent = _formatNumberForStep(v, step);
    onCommit(v);
  });

  wrap.appendChild(range);
  wrap.appendChild(readout);
  if (refs) {
    refs.range = range;
    refs.readout = readout;
  }
  return wrap;
}

// onChange resolution: hot-reload rows pass `applyTheme` as opts.onChange;
// rebuild rows just persist (no immediate handler).
function _resolveChange(opts: ControlOpts | undefined): () => void {
  if (opts && typeof opts.onChange === 'function') return opts.onChange;
  return function () {};
}

// Color <input type="color"> only accepts #RRGGBB. Convert from any CSS
// color string (rgba, named, etc.) to that form by round-tripping through
// a temporary DOM element so the browser does the parsing for us.
function _toHexInputValue(cssColor: string | unknown): string {
  if (typeof cssColor !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(cssColor)) return cssColor.toLowerCase();
  if (typeof document === 'undefined') return '#000000';
  const probe = document.createElement('span');
  probe.style.color = cssColor;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color; // → "rgb(R, G, B)"
  document.body.removeChild(probe);
  const m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// _formatNumberForStep(v, step) — derive readout precision from the slider
// step. A step of 0.0001 needs 4 decimals to render meaningful changes;
// a step of 50 should render as an integer.
function _formatNumberForStep(v: number, step: number): string {
  if (!Number.isFinite(v)) return String(v);
  const s = Math.abs(step);
  if (s >= 1) return v.toFixed(0);
  const stepStr = String(step);
  const dot = stepStr.indexOf('.');
  let decimals = dot === -1 ? 0 : stepStr.length - dot - 1;
  if (decimals > 6) decimals = 6;
  return v.toFixed(decimals);
}

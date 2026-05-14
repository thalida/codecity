// views/panes/controlsPane.js — "Controls" tab in the left sidebar.
//
// Layout:
//   .controls-pane (flex column)
//     .controls-header   — title
//     .controls-body     — scrollable column of sections (one per scene element)
//     .controls-actions  — sticky bottom bar: Reset all (left) · Discard · Save (right)
//
// Per-row affordance: a reset icon appears in the row's control area whenever
// the effective value (pending draft, else committed) differs from its
// registered default; click stages the default into the draft (Save still
// required to apply). Every input mutates a single in-memory draft layer
// (config/drafts.ts); the Save button flushes drafts to the real stores,
// which triggers the existing config/hotReload.js subscriptions (applyTheme
// or cityScene.applyManifest). Discard clears drafts without touching stores;
// page reload is an implicit discard.

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
  GEM_GLOW,
  GEM_ANIMATION,
  // Effects
  RAINBOW,
  // Live updates
  LIVE_UPDATES,
  SCAN_FILTERS,
} from '@/config/index.js';
import {
  getDefault,
  forEachRegisteredStore,
  onAnyChange,
} from '@/config/persist.js';
import {
  setDraft,
  getEffective,
  stageReset,
  stageResetAll,
  commit as commitDrafts,
  discard as discardDrafts,
  isDirty as draftsAreDirty,
  subscribe as subscribeDrafts,
} from '@/config/drafts.js';
import { KEY_BINDINGS } from '@/constants';
import { FadeDetail } from '@/types';
import { makeLucideIcon } from '@/views/shell/icon.js';
import { buildPaneHeader } from '@/views/shell/paneHeader.js';

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
//   onClose    — fn() invoked when the user clicks the × in the header.
//                Optional; if omitted, no close button is rendered.
//
// (onResetView is no longer used — the View section shows a kbd shortcut
// table including R, which the existing keydown handler in main.js wires
// to resetView. The "Reset camera" button is gone.)
interface BuildControlsPaneOpts {
  onClose?: () => void;
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export function buildControlsPane(opts: BuildControlsPaneOpts = {}): HTMLElement {

  const pane = document.createElement('div');
  pane.className = 'left-pane controls-pane';

  const { el: header } = buildPaneHeader({ title: 'Controls', onClose: opts.onClose });
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
  body.appendChild(_buildBackgroundSection());
  body.appendChild(_buildStreetsSection());
  body.appendChild(_buildBuildingsSection());
  body.appendChild(_buildGemSection());
  body.appendChild(_buildEffectsSection());
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
        tip: 'When on, untracked and gitignored files (node_modules/, build artifacts, drafts) are included. No effect outside a git repo. Saving re-fetches the manifest.',
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
function _buildBackgroundSection(): HTMLElement {
  const section = _section('Background', 'The void behind everything.');
  section.appendChild(
    _color('Sky / ground', SCENE_COLORS, 'GROUND', {
      tip: 'Color shown behind buildings + streets. Live.',
    })
  );
  return section;
}

// ─── Streets ───────────────────────────────────────────────────────────────
function _buildStreetsSection(): HTMLElement {
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
      }),
    ])
  );

  // Sidewalks. (No "Path" tint — the lineage from gem→selection is shown
  // by the rainbow neon line alone, see "Selection path line" below.)
  section.appendChild(
    _subgroup('Sidewalk colors', [
      _color('Default', SIDEWALK_COLORS, 'DEFAULT', {
        tip: 'Resting tint on every sidewalk.',
      }),
      _color('Hover', SIDEWALK_COLORS, 'HOVER', {
        tip: 'When the cursor is over a street.',
      }),
      _color('Selected', SIDEWALK_COLORS, 'SELECTED', {
        tip: 'When a street (directory) is selected.',
      }),
    ])
  );

  // Street labels
  section.appendChild(
    _subgroup('Street labels', [
      _color('Fill', LABEL_TYPOGRAPHY, 'FILL', {
        tip: 'Text color of the names painted on each road. Live (label textures regenerate on the fly when this changes).',
      }),
      _slider('Camera-flip dead zone', LABEL_TYPOGRAPHY, 'FLIP_HYSTERESIS', 0, 0.5, 0.01, {
        tip: 'How far the camera must rotate before labels flip 180° to stay readable. Higher = less flicker, more time spent reading upside-down.',
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
      }),
      _slider('Opacity', PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Path-line transparency. 0 = invisible; 1 = solid.',
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
      }),
      _color('Color', HOVER_PATH_LINE, 'COLOR', {
        tip: 'Solid color of the preview line. Faded white by default so it reads as a draft, not the committed rainbow line.',
      }),
      _number('Linewidth', HOVER_PATH_LINE, 'LINEWIDTH', 1, 20, 1, {
        tip: 'Pixel thickness of the preview line.',
      }),
      _slider('Opacity', HOVER_PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Preview-line transparency. 0 = invisible; 1 = solid.',
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
function _buildBuildingsSection(): HTMLElement {
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
      }),
      _color('Hover color', BUILDING_OUTLINE, 'HOVER_COLOR', {
        tip: 'Outline color when the cursor is over a building.',
      }),
      _slider('Hover opacity', BUILDING_OUTLINE, 'HOVER_OPACITY', 0, 1, 0.05, {}),
      _slider('Selected opacity', BUILDING_OUTLINE, 'SELECTED_OPACITY', 0, 1, 0.05, {
        tip: 'Selected outline uses an animated rainbow color — see Effects > Rainbow.',
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
      }),
      _toggle('Outline', BUILDING_FADE, 'DEFAULT_OUTLINE', {
        tip: 'Show the wireframe edge overlay.',
      }),
      _slider('Body opacity', BUILDING_FADE, 'DEFAULT_BODY_OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Opacity for the body / silhouette layer.',
      }),
      _slider('Outline opacity', BUILDING_FADE, 'DEFAULT_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Opacity for the wireframe outline layer (only visible if Outline is on).',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Level 1 — one hop from selection', [
      _select('Detail', BUILDING_FADE, 'NEAR_DETAIL', DETAIL_OPTIONS, {}),
      _toggle('Outline', BUILDING_FADE, 'NEAR_OUTLINE', {}),
      _slider('Body opacity', BUILDING_FADE, 'NEAR_BODY_OPACITY', 0.0, 1.0, 0.05, {}),
      _slider('Outline opacity', BUILDING_FADE, 'NEAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {}),
    ])
  );

  section.appendChild(
    _subgroup('Level 2+ — cousins, deeper subtrees', [
      _select('Detail', BUILDING_FADE, 'FAR_DETAIL', DETAIL_OPTIONS, {}),
      _toggle('Outline', BUILDING_FADE, 'FAR_OUTLINE', {}),
      _slider('Body opacity', BUILDING_FADE, 'FAR_BODY_OPACITY', 0.0, 1.0, 0.05, {}),
      _slider('Outline opacity', BUILDING_FADE, 'FAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {}),
    ])
  );

  return section;
}

// ─── Gem ───────────────────────────────────────────────────────────────────
function _buildGemSection(): HTMLElement {
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
      }),
      _slider('Plaza × gem width', GEM_SIZING, 'CLEARANCE_AS_GEM_WIDTH_FRAC', 0, 5, 0.1, {
        tip: "Dead-space pad past the gem at the root street's origin end, expressed as a multiple of the gem's diameter. 2 = plaza is two gem-widths long.",
      }),
    ])
  );

  section.appendChild(
    _subgroup('Appearance', [
      _color('Edge color', GEM_APPEARANCE, 'EDGE_COLOR', {
        tip: 'Neutral separator line drawn around each gem face.',
      }),
      _slider('Body opacity', GEM_APPEARANCE, 'BODY_OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Gem transparency. Low = jewel-like; high = plastic.',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Glow halo', [
      _toggle('Enabled', GEM_GLOW, 'ENABLED', {
        tip: 'Two billboarded sprites behind the gem painted with a soft radial-gradient — creates a fuzzy neon halo.',
      }),
      _slider('Inner scale × radius', GEM_GLOW, 'INNER_SCALE', 1, 12, 0.1, {
        tip: 'Size of the inner "hot core" halo, as a multiple of the gem radius. Larger = bigger soft disk.',
      }),
      _slider('Inner opacity', GEM_GLOW, 'INNER_OPACITY', 0, 1, 0.05, {
        tip: 'Brightness of the hot core. Lower for a subtler halo.',
      }),
      _slider('Outer scale × radius', GEM_GLOW, 'OUTER_SCALE', 1, 30, 0.5, {
        tip: 'Size of the outer atmospheric halo. Much larger than the inner one so the falloff reaches far past the gem.',
      }),
      _slider('Outer opacity', GEM_GLOW, 'OUTER_OPACITY', 0, 1, 0.05, {
        tip: 'Brightness of the atmospheric halo.',
      }),
      _toggle('Animate colors', GEM_GLOW, 'ANIMATE_COLORS', {
        tip: 'Cycle the halo color through the gem face palette. Off = halo uses the edge color from Appearance above.',
      }),
      _slider('Cycle period (s)', GEM_GLOW, 'CYCLE_PERIOD_SECONDS', 1, 30, 0.5, {
        tip: 'Seconds for one full pass through every palette color.',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Animation', [
      _slider('Rotation speed', GEM_ANIMATION, 'ROTATION_SPEED', 0, 3, 0.05, {}),
      _slider('Bob frequency', GEM_ANIMATION, 'BOB_FREQUENCY', 0, 5, 0.1, {
        tip: 'How fast the gem oscillates vertically.',
      }),
      _slider('Bob amplitude', GEM_ANIMATION, 'BOB_AMPLITUDE_FRAC', 0, 2, 0.05, {
        tip: 'Vertical bob distance, as a fraction of the gem radius.',
      }),
      _slider('Hover scale', GEM_ANIMATION, 'HOVER_SCALE', 1, 3, 0.05, {
        tip: 'Multiplier applied to the gem when the cursor is over it.',
      }),
      _slider('Hover lerp', GEM_ANIMATION, 'SCALE_LERP_SPEED', 0.01, 1, 0.01, {
        tip: 'Per-frame ease toward the hover scale.',
      }),
    ])
  );

  return section;
}

// ─── Effects ───────────────────────────────────────────────────────────────
function _buildEffectsSection(): HTMLElement {
  const section = _section('Effects', 'Shared visual effects.');

  section.appendChild(
    _subgroup('Rainbow (selected outline + path line)', [
      _slider('Speed', RAINBOW, 'SPEED', 0, 0.005, 0.0001, {
        tip: 'Hue cycles per millisecond. The shared rainbow chases around the selected building outline AND the gem→selection path line.',
      }),
      _slider('Saturation', RAINBOW, 'SATURATION', 0, 1, 0.05, {}),
      _slider('Lightness', RAINBOW, 'LIGHTNESS', 0, 1, 0.05, {}),
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
// Three-button bar: Reset all (left) | Discard · Save (right).
// Widgets write to the draft layer; Save commits to stores (triggering
// the existing persist + hot-reload subscriptions). Discard drops pending
// drafts without touching stores. Reset all stages every overridden value
// back to its default — user still must Save to apply.
function _buildActionsSection(): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'controls-actions';

  const left = document.createElement('div');
  left.className = 'controls-actions-left';

  const right = document.createElement('div');
  right.className = 'controls-actions-right';

  const resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.className = 'controls-button controls-button-secondary';
  resetAll.appendChild(makeLucideIcon('rotate-ccw', { class: 'controls-button-icon' }));
  resetAll.appendChild(document.createTextNode('Reset all'));
  resetAll.title = 'Stage every overridden value back to its default. Click Save to apply.';
  resetAll.addEventListener('click', () => {
    if (resetAll.disabled) return;
    stageResetAll();
  });
  left.appendChild(resetAll);

  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'controls-button controls-button-secondary';
  discard.textContent = 'Discard';
  discard.title = 'Drop all unsaved changes.';
  discard.addEventListener('click', () => {
    if (discard.disabled) return;
    discardDrafts();
  });
  right.appendChild(discard);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'controls-button';
  save.textContent = 'Save';
  save.title = 'Apply unsaved changes to the scene.';
  save.addEventListener('click', () => {
    if (save.disabled) return;
    commitDrafts();
  });
  right.appendChild(save);

  actions.appendChild(left);
  actions.appendChild(right);

  function refresh() {
    const dirty = draftsAreDirty();
    save.disabled = !dirty;
    discard.disabled = !dirty;

    // Reset all enabled iff at least one (store, key) has an effective
    // value that differs from its default — i.e., the click would stage
    // at least one new draft entry. (Same loop shape as stageResetAll.)
    let canReset = false;
    forEachRegisteredStore((_name, store, defaults) => {
      if (canReset) return;
      if (
        defaults &&
        typeof defaults === 'object' &&
        !Array.isArray(defaults) &&
        typeof (store as MapLikeStore).setKey === 'function'
      ) {
        for (const k in defaults) {
          if (!Object.hasOwn(defaults, k)) continue;
          if (!_isEqual(getEffective(store as MapLikeStore, k), (defaults as Record<string, unknown>)[k])) {
            canReset = true;
            return;
          }
        }
      } else {
        if (!_isEqual(getEffective(store as MapLikeStore, null), defaults)) canReset = true;
      }
    });
    resetAll.disabled = !canReset;
  }
  refresh();
  subscribeDrafts(refresh);
  onAnyChange(refresh);

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
// default (checking effective/draft value). Click stages a reset for each
// key; user must Save to commit.
function _makeResetButton(
  store: MapLikeStore,
  keys: string[],
  _opts: ControlOpts
): HTMLButtonElement {
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
    for (const k of keys) stageReset(store, k);
  });

  function refresh() {
    btn.disabled = keys.every((k) =>
      _isEqual(getEffective(store, k), getDefault(store, k))
    );
  }
  refresh();
  store.subscribe(refresh);
  subscribeDrafts(refresh);
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
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'theme-color';
  input.value = _toHexInputValue(getEffective(store, key));
  input.addEventListener('input', () => {
    setDraft(store, key, input.value);
  });
  const refresh = () => {
    const hex = _toHexInputValue(getEffective(store, key));
    if (input.value.toLowerCase() !== hex) input.value = hex;
  };
  store.subscribe(refresh);
  subscribeDrafts(refresh);
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
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(getEffective(store, key));
  input.className = 'theme-number';
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) setDraft(store, key, v);
  });
  const refresh = () => {
    const s = String(getEffective(store, key));
    if (input.value !== s && document.activeElement !== input) input.value = s;
  };
  store.subscribe(refresh);
  subscribeDrafts(refresh);
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
  const refs = {} as SliderRefs;
  const control = _sliderWidget(
    getEffective(store, key) as number,
    min,
    max,
    step,
    (v) => {
      setDraft(store, key, v);
    },
    refs
  );
  const refresh = () => {
    const v = getEffective(store, key) as number;
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, step);
    }
  };
  store.subscribe(refresh);
  subscribeDrafts(refresh);
  return _row(label, control, store, [key], opts);
}

// _nestedSlider — like _slider but the value lives at store.get()[parentKey][subKey].
// Writes go through `setDraft(store, parentKey, { ...current, [subKey]: v })` so other
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
  const refs = {} as SliderRefs;
  const effectiveMap = () => (getEffective(store, parentKey) as any) || {};
  const initial = effectiveMap()[subKey];

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
      const current = effectiveMap();
      const next = {} as Record<string, unknown>;
      for (const k in current) {
        if (Object.hasOwn(current, k)) next[k] = current[k];
      }
      next[subKey] = v;
      setDraft(store, parentKey, next);
      if (swatch) swatch.style.background = `hsl(${v}, 80%, 55%)`;
    },
    refs
  );

  const refresh = () => {
    const v = effectiveMap()[subKey];
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, step);
      if (swatch) swatch.style.background = `hsl(${v}, 80%, 55%)`;
    }
  };
  store.subscribe(refresh);
  subscribeDrafts(refresh);

  const rowOpts: ControlOpts = { ...opts };
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
  const effectiveTiers = () => (getEffective(STREET_TIERS, null) as any[]) || [];
  const initial = (effectiveTiers()[index] || {}).width;

  const control = _sliderWidget(
    initial,
    1,
    100,
    1,
    (v) => {
      const current = effectiveTiers();
      const next = current.slice();
      next[index] = { min_descendants: current[index].min_descendants, width: v };
      setDraft(STREET_TIERS, null, next);
    },
    refs
  );

  const refresh = () => {
    const v = (effectiveTiers()[index] || {}).width;
    if (parseFloat(refs.range.value) !== v) {
      refs.range.value = String(v);
      refs.readout.textContent = _formatNumberForStep(v, 1);
    }
  };
  STREET_TIERS.subscribe(refresh);
  subscribeDrafts(refresh);

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

  const defaultArr = (getDefault(STREET_TIERS) as any[]) || [];
  const defaultVal = (defaultArr[index] || {}).width;
  btn.title = `Default: ${_formatDefaultValue(defaultVal)}`;

  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const current = (getEffective(STREET_TIERS, null) as any[]) || [];
    const next = current.slice();
    next[index] = { min_descendants: current[index].min_descendants, width: defaultVal };
    setDraft(STREET_TIERS, null, next);
  });

  function refresh() {
    const arr = (getEffective(STREET_TIERS, null) as any[]) || [];
    const v = (arr[index] || {}).width;
    btn.disabled = _isEqual(v, defaultVal);
  }
  refresh();
  STREET_TIERS.subscribe(refresh);
  subscribeDrafts(refresh);
  return btn;
}

function _makeNestedResetButton(
  store: MapLikeStore,
  parentKey: string,
  subKey: string,
  _opts: ControlOpts
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-row-reset';
  btn.setAttribute('aria-label', 'Reset to default');
  btn.appendChild(makeLucideIcon('rotate-ccw'));

  const defaultMap = (getDefault(store, parentKey) as Record<string, unknown>) || {};
  const defaultVal = defaultMap[subKey];
  btn.title = `Default: ${_formatDefaultValue(defaultVal)}`;

  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const current = ((getEffective(store, parentKey) as Record<string, unknown>) || {});
    const next = {} as Record<string, unknown>;
    for (const k in current) {
      if (Object.hasOwn(current, k)) next[k] = current[k];
    }
    next[subKey] = defaultVal;
    setDraft(store, parentKey, next);
  });

  function refresh() {
    const v = ((getEffective(store, parentKey) as Record<string, unknown>) || {})[subKey];
    btn.disabled = _isEqual(v, defaultVal);
  }
  refresh();
  store.subscribe(refresh);
  subscribeDrafts(refresh);
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
      setDraft(store, key, opt.value);
    });
    wrap.appendChild(btn);
    return btn;
  });

  const refresh = () => {
    const current = getEffective(store, key);
    for (const btn of buttons) {
      btn.classList.toggle('is-active', btn.dataset.value === current);
    }
  };
  refresh();
  store.subscribe(refresh);
  subscribeDrafts(refresh);
  return _row(label, wrap, store, [key], opts);
}

// _toggle — boolean checkbox. Reflects external changes (reset-to-default).
function _toggle(
  label: string,
  store: MapLikeStore,
  key: string,
  opts: ControlOpts
): HTMLLabelElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'theme-toggle';
  input.checked = !!getEffective(store, key);
  input.addEventListener('change', () => {
    setDraft(store, key, input.checked);
  });
  const refresh = () => {
    const v = !!getEffective(store, key);
    if (input.checked !== v) input.checked = v;
  };
  store.subscribe(refresh);
  subscribeDrafts(refresh);
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
  const initialMin = getEffective(store, minKey) as number;
  const initialMax = getEffective(store, maxKey) as number;

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
  const loRange = makeRange(initialMin);
  loRange.classList.add('theme-range-pair-lo');
  const hiRange = makeRange(initialMax);
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
    setDraft(store, minKey, l);
    setDraft(store, maxKey, h);
    paint();
  }

  loRange.addEventListener('input', commit);
  hiRange.addEventListener('input', commit);
  paint();

  const refresh = () => {
    let changed = false;
    const eMin = getEffective(store, minKey) as number;
    const eMax = getEffective(store, maxKey) as number;
    if (parseFloat(loRange.value) !== eMin) {
      loRange.value = String(eMin);
      changed = true;
    }
    if (parseFloat(hiRange.value) !== eMax) {
      hiRange.value = String(eMax);
      changed = true;
    }
    if (changed) paint();
  };
  store.subscribe(refresh);
  subscribeDrafts(refresh);

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

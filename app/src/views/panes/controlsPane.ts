// views/panes/controlsPane.js — "Controls" tab in the left sidebar.
//
// Layout:
//   .controls-pane (flex column)
//     .pane-header       — shared header (title + × close) via buildPaneHeader()
//     .controls-body     — scrollable column of sections (one per scene element)
//     .controls-actions  — sticky bottom bar: Reset all (left) · Discard · Save (right)
//
// Per-row affordance: a reset icon appears in the row's control area whenever
// the effective value (pending draft, else committed) differs from its
// registered default; click stages the default into the draft (Save still
// required to apply). Every input mutates a single in-memory draft layer
// (config/drafts.ts); the Save button flushes drafts to the real stores,
// which triggers the existing config/hotReload.js subscriptions (applyTheme
// or world.applyManifest). Discard clears drafts without touching stores;
// page reload is an implicit discard.

import {
  // Scene (ground haze / fog)
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
  BUILDING_AGING,
  // Gem
  GEM_SIZING,
  GEM_APPEARANCE,
  GEM_GLOW,
  GEM_ANIMATION,
  // Effects
  RAINBOW,
  BLOOM,
  // Live updates
  LIVE_UPDATES,
  // File preview
  SYNTAX_THEME,
  SYNTAX_THEME_DEFAULT,
  SYNTAX_THEME_OPTIONS,
  // Fly mode
  FLY_CONTROLS,
} from '@/config/index.js';
import { SKY, SKY_STARS } from '@/config/components/sky.js';
import { REPO_LABEL } from '@/config/components/repoLabel.js';
import { ISLAND_GEOMETRY, ISLAND_MATERIALS } from '@/config/components/island.js';
import { WORLD } from '@/config/world/world.js';
import { TREES } from '@/config/components/trees.js';
import { FOOTPRINT } from '@/config/components/footprint.js';
import { FACADE_GEOMETRY, FACADE_DETAIL, WINDOW_LIGHTING } from '@/config/components/facade.js';
import { AD_PANEL } from '@/config/components/adPanels.js';
import { ANIMATION_TIMING } from '@/config/system/animator.js';
import { getDefault, forEachRegisteredStore, onAnyChange } from '@/store/persist.js';
import {
  setDraft,
  getEffective,
  stageReset,
  stageResetAll,
  commit as commitDrafts,
  discard as discardDrafts,
  isDirty as draftsAreDirty,
  subscribe as subscribeDrafts,
} from '@/store/configDrafts.js';
import { KEY_BINDINGS } from '@/constants';
import { FadeDetail } from '@/types';
import { makeLucideIcon } from '@/views/widgets/icon.js';
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

interface ControlsPaneBundle {
  pane: HTMLElement;
  /** Collapse every <details> section inside the pane. Called by the left
   *  sidebar whenever the Controls tab becomes visible so the panel always
   *  opens fresh — no state memory between opens. */
  resetCollapsed: () => void;
}

export function buildControlsPane(opts: BuildControlsPaneOpts = {}): ControlsPaneBundle {
  const pane = document.createElement('div');
  pane.className = 'pane controls-pane';

  const { el: header } = buildPaneHeader({ title: 'Controls', onClose: opts.onClose });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body pane-body--padded';

  // Sections are organized by render scope, then interaction:
  //   Keyboard & mouse → Scan & Updates → Scene → Layout →
  //   Buildings → Streets → Root gem → Effects → File Preview → Debug.
  // (Fly mode tuning lives inside Keyboard & mouse as a collapsible
  // subgroup next to the fly-mode shortcuts cheat sheet.)
  //
  // (Camera tween timing / easing — BASE_DURATION_MS, EASING_POWER — is
  // intentionally NOT exposed to users. The defaults are tuned for the
  // intended feel; let developers tweak ANIMATION_TIMING in code if needed.)
  //
  // All sections are <details> elements. Open/closed state is NOT persisted —
  // every time the Controls tab becomes visible all sections start collapsed.
  // See _section() and resetCollapsed() below.
  body.appendChild(_buildShortcutsSection());
  body.appendChild(_buildUpdatesSection());
  // Scene now subsumes the old Sky section — every backdrop-y knob
  // (sky color, stars, ground haze, sun lighting) lives in collapsible
  // subgroups inside one Scene section.
  body.appendChild(_buildSceneSection());
  // Island sits immediately after Scene — it's the world-plane object that
  // the city floats on, so it reads as part of the backdrop group.
  body.appendChild(_buildIslandSection());
  // The old Layout section was folded away: street width tiers + street
  // spacing live under Streets, building size lives under Buildings.
  body.appendChild(_buildBuildingsSection());
  body.appendChild(_buildStreetsSection());
  body.appendChild(_buildGemSection());
  // Trees sit after Gem (the world's anchor) so the panel
  // reads structural → decorative top-to-bottom.
  body.appendChild(_buildTreesSection());
  body.appendChild(_buildEffectsSection());
  body.appendChild(_buildFilePreviewSection());
  if (
    typeof opts.onRunCollisionCheck === 'function' ||
    typeof opts.onRunStemDiagnostic === 'function'
  ) {
    body.appendChild(_buildDebugSection(opts.onRunCollisionCheck, opts.onRunStemDiagnostic));
  }

  pane.appendChild(body);
  pane.appendChild(_buildActionsSection()); // sticky bottom — sibling of body

  function resetCollapsed(): void {
    pane.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => {
      d.open = false;
    });
  }

  return { pane, resetCollapsed };
}

// ─── Scan & Updates ────────────────────────────────────────────────────────
// What the scanner picks up + when to re-scan. Live updates polls
// /api/manifest/signature on a clamped [1s, 60s] interval so an
// over-eager value can't ddos the local server.
function _buildUpdatesSection(): HTMLElement {
  const section = _section(
    'Scan & Updates',
    'What the scanner picks up, and how it stays in sync.'
  );
  section.appendChild(
    _subgroup('Live updates', [
      _toggle('Enabled', LIVE_UPDATES, 'ENABLED', {
        tip: "When on, the city re-renders in place every poll interval if the scanned tree's mtime/size signature changed.",
      }),
      _number('Poll interval (s)', LIVE_UPDATES, 'POLL_SECONDS', 1, 60, 1, {
        tip: 'How often to re-fetch the manifest. Lower = snappier; higher = lighter on the local server. Below 1s hammers the backend; above 60s the city feels stale.',
      }),
    ])
  );
  return section;
}

// ─── Camera & Interaction ─────────────────────────────────────────────────
// Camera lens / orbit / animation timings, plus input + tooltip stores.
// The Keyboard & mouse subgroup is the old "View" section's shortcuts
// table — no "Reset camera" button because R already covers that, and
// the full shortcut list makes orbit / pan / zoom / focus / select
// discoverable too.
// ─── Keyboard & mouse ──────────────────────────────────────────────────────
// Top-level section so the shortcut cheat-sheet is the first thing a new
// user sees — separate from the Camera & Interaction tuning section.
function _buildShortcutsSection(): HTMLElement {
  const section = _section(
    'Keyboard & mouse',
    'Quick reference for cursor actions and keyboard shortcuts.'
  );
  section.appendChild(
    _subgroup(
      'General',
      _buildShortcutsList([
        { kbd: [KEY_BINDINGS.RESET_VIEW.label], action: 'Reset the camera view' },
        {
          kbd: [KEY_BINDINGS.FOCUS_SELECTION.label],
          action: 'Focus camera on the current selection',
        },
        { kbd: [KEY_BINDINGS.CLEAR_SELECTION.label], action: 'Clear selection' },
        { kbd: [KEY_BINDINGS.TOGGLE_FLY_MODE.label], action: 'Toggle fly mode' },
        null,
        { mouse: 'Click', action: 'Select building / street / gem' },
        { mouse: 'Double-click', action: 'Focus camera on the target' },
      ])
    )
  );
  section.appendChild(
    _subgroup(
      'Orbit mode',
      _buildShortcutsList([
        { mouse: 'Left drag', action: 'Orbit' },
        { mouse: 'Right drag', action: 'Pan' },
        { mouse: 'Middle drag', action: 'Dolly (zoom)' },
        { mouse: 'Scroll', action: 'Zoom toward cursor' },
      ])
    )
  );
  section.appendChild(
    _subgroup(
      'Fly mode',
      _buildShortcutsList([
        { kbd: ['W', 'A', 'S', 'D'], action: 'Forward / strafe' },
        { kbd: ['Q', 'E'], action: 'Drop / rise' },
        { kbd: ['Shift'], action: 'Boost (hold)' },
        { mouse: 'Left / right drag', action: 'Look around' },
      ])
    )
  );

  // Fly-mode tuning — collapsible so the always-visible shortcut cheat
  // sheet above stays compact. All values are read fresh per frame so
  // edits take effect immediately; Save still required to persist across
  // page reloads (same draft layer as every other tunable in this pane).
  section.appendChild(
    _collapsibleSubgroup('fly-mode-settings', 'Fly mode settings', () => [
      _subgroup('Speed', [
        _number('Base speed (bbox fraction)', FLY_CONTROLS, 'BASE_SPEED_BBOX_FRAC', 0.01, 1, 0.01, {
          tip: 'Base camera speed as a fraction of the world bounding-box radius. Scales automatically with city size.',
        }),
        _number('Base speed (min)', FLY_CONTROLS, 'BASE_SPEED_MIN', 0.1, 100, 0.5, {
          tip: 'Minimum base speed in world units/sec — floor so the camera never crawls to a halt in tiny repos.',
        }),
        _number('Base speed (max)', FLY_CONTROLS, 'BASE_SPEED_MAX', 1, 2000, 5, {
          tip: 'Maximum base speed in world units/sec — cap so the camera does not rocket through large repos.',
        }),
        _number('Boost multiplier', FLY_CONTROLS, 'BOOST_MULT', 1, 20, 0.5, {
          tip: 'Speed multiplier applied while Shift is held. 1 = no boost; 4 = four times faster.',
        }),
      ]),
      _subgroup('Feel', [
        _slider('Mouse sensitivity', FLY_CONTROLS, 'MOUSE_SENSITIVITY', 0.0005, 0.01, 0.0001, {
          tip: 'Radians of view rotation per pixel of pointer-lock movement. Lower = slower, more precise; higher = faster.',
        }),
        _slider('Pitch clamp (deg)', FLY_CONTROLS, 'PITCH_CLAMP_DEG', 30, 89, 1, {
          tip: 'Maximum up/down look angle in degrees. Prevents gimbal-lock at 90°.',
        }),
        _number('Accel ramp (ms)', FLY_CONTROLS, 'ACCEL_RAMP_MS', 0, 1000, 10, {
          tip: 'Time in milliseconds to reach full speed from rest (and to coast to a stop). 0 = instant; higher = floaty.',
        }),
        _number('Altitude floor', FLY_CONTROLS, 'ALTITUDE_FLOOR', 0, 50, 0.1, {
          tip: 'Minimum world-Y position — prevents flying below the ground plane.',
        }),
      ]),
      _subgroup('Entry pose (on fly-mode enter)', [
        _number(
          'Gem offset multiplier',
          FLY_CONTROLS,
          'FLY_DEFAULT_GEM_OFFSET_MULT',
          0.5,
          10,
          0.1,
          {
            tip: 'Starting distance behind the gem expressed as a multiple of the gem radius.',
          }
        ),
        _slider('Altitude fraction', FLY_CONTROLS, 'FLY_DEFAULT_ALTITUDE_FRAC', 0.05, 2, 0.05, {
          tip: 'Starting height as a fraction of the tallest building. 0.3 = eye-level with a mid-rise; 1.0 = rooftop height of the tallest building.',
        }),
      ]),
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

// ─── Scene ─────────────────────────────────────────────────────────────────
// Everything that paints behind / around the city:
//   Sky          — the procedural icosphere (cyberpunk gradient + stars)
//   Ground       — the world floor mesh anchored at the gem
//   Stars        — hashed star field + twinkle (lives inside the sky shader)
//   Ground haze  — atmospheric fog mix on the building shader
//   Sun lighting — directional sun (azimuth, elevation, ambient, contrast)
// Each is a collapsible subgroup so the section stays scannable.
function _buildSceneSection(): HTMLElement {
  const section = _section(
    'Scene',
    'Sky, stars, ground, and atmosphere — everything that frames the city. (Sun lighting is fixed in code.)'
  );

  section.appendChild(
    _collapsibleSubgroup('scene-sky', 'Sky', () => [
      _color('Sky color', SKY, 'COLOR', {
        tip: 'Solid color painted across the entire sphere. Past the world floor edge the camera sees this color directly, so the plane reads as floating in space.',
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('scene-stars', 'Stars', () => [
      _toggle('Enabled', SKY_STARS, 'ENABLED', {
        tip: 'When off, no stars are sampled (also disables twinkle).',
      }),
      _slider('Density', SKY_STARS, 'DENSITY', 0, 0.02, 0.0005, {
        tip: 'Hash-threshold for star presence — higher density paints MORE stars. Above ~0.01 the sky reads as a noise field.',
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('scene-ground', 'Ground sizing', () => [
      _slider('Ground buffer (% of city)', WORLD, 'GROUND_BUFFER_PERCENT', 0, 100, 1, {
        tip: "Padding around the city as a percentage of the city's longest dimension. 0% = island exactly fits the city; 50% = generous halo of bare ground past the buildings.",
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('scene-haze', 'Ground haze', () => [
      _toggle('Enabled', SCENE_COLORS, 'FOG_ENABLED', {
        tip: "Off → no haze (the shader's fog mix is a no-op). Other knobs stay in config so flipping back restores the mood.",
      }),
      _color('Color', SCENE_COLORS, 'FOG_COLOR', {
        tip: 'Tint that building bases mix toward. Match the sky/ground for a seamless horizon.',
      }),
      _slider('Intensity', SCENE_COLORS, 'FOG_INTENSITY', 0, 1, 0.05, {
        tip: 'Peak fog amount at world Y=0 (street level). 0 = off; 1 = ground plane fully tinted to fog color.',
      }),
      _slider('Falloff height ×', SCENE_COLORS, 'FOG_HEIGHT_FRAC', 0, 1, 0.05, {
        tip: 'Half-fall-off height as a fraction of the tallest possible building (BUILDING_DIMENSIONS.MAX_FLOORS × FLOOR_HEIGHT). Auto-scales with the building config so the mist sits in the same relative band of the skyline. 0.25 = mist fades by mid-height of short buildings; 0.5 = halfway up the tallest.',
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('scene-repo-label', 'Repo label', () => [
      _toggle('Enabled', REPO_LABEL, 'ENABLED', {
        tip: 'Master toggle for the floating holographic repo-name label.',
      }),
      _slider('Height', REPO_LABEL, 'HEIGHT', 0, 2500, 5, {
        tip: "Panel bottom's elevation above the floor, in world units. 0 = flush with the floor (no beam). Larger lifts the panel and grows the beam underneath. Default 1305 ≈ 0.85 × the tallest possible building — sits inside the silhouette band of an extreme-tall city but above any typical one.",
      }),
      _slider('Font size', REPO_LABEL, 'FONT_SIZE', 10, 300, 1, {
        tip: "Panel (= text) height in world units. Default 96 matches BUILDING_DIMENSIONS.MAX_WIDTH — the label reads as roughly the same scale as the biggest possible single building. Width scales with text length so long names don't squish.",
      }),
      _slider('Animation speed', REPO_LABEL, 'ANIMATION_SPEED', 0, 4, 0.05, {
        tip: 'Multiplier on the holographic scanline / glitch rate. 0 freezes the label; 4 reads as frantic.',
      }),
      _slider('Opacity', REPO_LABEL, 'OPACITY', 0, 1, 0.05, {
        tip: 'Master opacity. 0 invisible, 1 fully painted.',
      }),
      _color('Beam color', REPO_LABEL, 'BEAM_COLOR', {
        tip: 'Color of the light beam rising from the gem.',
      }),
      _color('Text color', REPO_LABEL, 'TEXT_COLOR', {
        tip: 'Tint applied to the holographic text. White preserves the chromatic-aberration look; other colors fold the aberration into the chosen hue.',
      }),
    ])
  );

  return section;
}

// ─── Island (Cyberpunk Valley) ─────────────────────────────────────────────
// The floating-island world-plane beneath the city. Two collapsible
// subgroups cover:
//   Geometry    — polygon shape, depth, tiers (cheap vertex rebuild on refresh)
//   Materials   — vertex-baked colors + hemispheric lighting uniforms
function _buildIslandSection(): HTMLElement {
  const section = _section(
    'Island',
    'Floating-island world-plane beneath the city. Geometry controls the polygon silhouette and depth; Materials set the baked colors and lighting.'
  );

  section.appendChild(
    _collapsibleSubgroup('island-geometry', 'Geometry', () => [
      _toggle('Show island', ISLAND_GEOMETRY, 'ENABLED', {
        tip: 'Master toggle for the floating-island mesh. When off, the city sits over empty sky.',
      }),
      _slider('Polygon sides', ISLAND_GEOMETRY, 'SIDES', 6, 48, 1, {
        tip: 'How many sides the island top has. Also drives triangle density horizontally — each side contributes 2 triangles per tier band. 6 = hexagon (chunky big facets); 12 = dodecagon (default); 48 = lots of small facets.',
      }),
      _slider('Irregularity', ISLAND_GEOMETRY, 'IRREGULARITY', 0, 0.5, 0.01, {
        tip: '0 = perfectly regular polygon. Higher values jitter vertices inward for a natural island silhouette.',
      }),
      _slider('Tier rings', ISLAND_GEOMETRY, 'TIERS', 1, 10, 1, {
        tip: 'How many chunky tier rings make up the underside. 1 = sharp cone; 4–6 = chunky tapered look; 10 = lots of facet detail.',
      }),
      _slider('Depth (× radius)', ISLAND_GEOMETRY, 'DEPTH', 0.2, 2.0, 0.05, {
        tip: 'Total island depth as a fraction of island radius. Larger = deeper, more "iceberg" silhouette.',
      }),
      _slider('Roundness', ISLAND_GEOMETRY, 'ROUNDNESS', 0, 1, 0.05, {
        tip: 'Body shape. 0 = pointed taper to a tip; 1 = very rounded bowl. 0.7 = the current default smooth-rounded shape.',
      }),
      _slider('Grass thickness', ISLAND_GEOMETRY, 'GRASS_THICKNESS', 0, 0.1, 0.005, {
        tip: 'Vertical thickness of the green grass layer as a fraction of island radius. 0 = no grass band, just the flat top.',
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('island-materials', 'Materials', () => [
      _color('Grass color', ISLAND_MATERIALS, 'GRASS_COLOR', {
        tip: 'Top surface where the city sits.',
      }),
      _color('Grass side color', ISLAND_MATERIALS, 'GRASS_SIDE_COLOR', {
        tip: 'Vertical band wrapping the top edge. Side faces point outward, so hemispheric lighting hits them very differently than the top — tune this brighter than Grass color if the side band reads too dim.',
      }),
      _color('Rock color', ISLAND_MATERIALS, 'ROCK_COLOR', {
        tip: 'Uniform rock/earth color for the cliff band, tier rings, and bottom cap. Per-face lighting provides all the visual variation.',
      }),
      _color('Hemi sky color', ISLAND_MATERIALS, 'HEMI_SKY_COLOR', {
        tip: 'Warm "from above" tone blended onto upward-facing surfaces by the hemispheric lighting model.',
      }),
      _color('Hemi ground color', ISLAND_MATERIALS, 'HEMI_GROUND_COLOR', {
        tip: 'Cool "from below" tone blended onto downward-facing surfaces by the hemispheric lighting model.',
      }),
    ])
  );

  return section;
}

// ─── Trees (Cyberpunk Valley) ──────────────────────────────────────────────
// Commit-driven trees: one per commit. Oldest commit closest to the gem;
// newest farthest. Height encodes commit AGE (older = taller), width
// encodes commit FILES (more files = wider canopy), color interpolates
// between TREE_COLOR_SOLO_DAY (solo-commit days) and TREE_COLOR_BUSY_DAY (busy
// days) by commits-per-day.
function _buildTreesSection(): HTMLElement {
  const section = _section(
    'Trees',
    'Commit-driven trees — one canopy per commit. Height tracks commit age (older = taller). Width tracks commit size (more files = wider). Color tracks COMMITS-PER-DAY — solo-commit days lean toward TREE_COLOR_SOLO_DAY; busy days lean toward TREE_COLOR_BUSY_DAY. All commits on the same date share a color.'
  );

  section.appendChild(
    _subgroup('Visibility', [
      _toggle('Trees enabled', TREES, 'TREES_ENABLED', {
        tip: 'Master toggle. When off, all tree canopies + trunks are hidden (mesh.visible flip — no rebuild).',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Placement', [
      _slider('Edge inset (% of plane)', TREES, 'EDGE_INSET_PERCENT', 0, 50, 1, {
        tip: 'Trees stop short of the plane edge by this fraction of the SHORTER axis. Rebuild on change.',
      }),
      _slider('Density falloff', TREES, 'TREE_DENSITY_FALLOFF', 0, 50, 0.1, {
        tip: 'How tightly trees cluster near the city. 0 = uniform spread. Higher = denser near city, sparser at edges (acceptance prob = (1 - dist/maxDist)^falloff). Very high values (>20) push almost every tree into a dense ring right at the city edge. Rebuild on change.',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Color by commits-per-day', [
      _color('Busy-day color', TREES, 'TREE_COLOR_BUSY_DAY', {
        tip: 'Color for commits on a busy day — many commits sharing the same date. Live.',
      }),
      _color('Solo-day color', TREES, 'TREE_COLOR_SOLO_DAY', {
        tip: 'Color for commits on a solo day — only one commit that date. Live.',
      }),
      _color('Trunk color', TREES, 'TREE_TRUNK_COLOR', {
        tip: 'Color of every tree trunk. Live.',
      }),
      _slider('Shading strength', TREES, 'TREE_SHADING_STRENGTH', 0, 1, 0.05, {
        tip: 'Baked vertex-color gradient depth on the canopy. 0 = flat (no shading), 1 = fully dark at the base. Rebuild on change.',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Age desaturation', [
      _toggle('Age desaturation enabled', TREES, 'TREE_AGE_DESAT_ENABLED', {
        tip: 'When on, older commits fade toward gray — newest commits keep full color, oldest are washed out. Live.',
      }),
      _rangePair(
        'Saturation range',
        TREES,
        'TREE_AGE_SATURATION_MIN',
        'TREE_AGE_SATURATION_MAX',
        0,
        100,
        1,
        {
          tip: 'Saturation retained at the OLDEST (left) and NEWEST (right) commit — percent 0–100. At 20 the oldest tree keeps only 20% of its base color saturation; at 100 it is fully saturated. Live.',
        }
      ),
    ])
  );

  section.appendChild(
    _subgroup('Height by age', [
      _slider('Min height', TREES, 'TREE_MIN_HEIGHT', 4, 400, 4, {
        tip: 'Height (world units) of the newest commit. Older commits grow taller toward Max. Independent of building dimensions. Rebuild on change.',
      }),
      _slider('Max height', TREES, 'TREE_MAX_HEIGHT', 16, 800, 4, {
        tip: 'Height (world units) of the oldest commit. Independent of building dimensions. Rebuild on change.',
      }),
      _slider('Trunk height (% of canopy)', TREES, 'TRUNK_HEIGHT_FRAC', 0.05, 1, 0.05, {
        tip: 'Trunk height as a fraction of canopy height. Larger = more visible trunk relative to canopy. Rebuild on change.',
      }),
      _slider('Canopy-trunk overlap (% of trunk)', TREES, 'CANOPY_TRUNK_OVERLAP_FRAC', 0, 1, 0.05, {
        tip: 'How much of the trunk top is hidden inside the canopy. 0 = canopy bottom point touches trunk top. 1 = canopy bottom reaches the ground, hiding the entire trunk. Rebuild on change.',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Width by files', [
      _slider('Min canopy width', TREES, 'TREE_MIN_WIDTH', 2, 400, 2, {
        tip: 'Canopy diameter (world units) of commits with the fewest files changed. Independent of building dimensions. Rebuild on change.',
      }),
      _slider('Max canopy width', TREES, 'TREE_MAX_WIDTH', 4, 600, 2, {
        tip: 'Canopy diameter (world units) of commits with the most files changed. Independent of building dimensions. Rebuild on change.',
      }),
      _slider(
        'Trunk thickness (% of canopy)',
        TREES,
        'TRUNK_RADIUS_FRAC_OF_CANOPY',
        0.05,
        0.5,
        0.01,
        {
          tip: 'Trunk XZ radius as a fraction of canopy radius. Wider canopies get thicker trunks proportionally. Rebuild on change.',
        }
      ),
    ])
  );

  return section;
}

// ─── Layout ────────────────────────────────────────────────────────────────
// Geometric packing knobs: street width tiers, street spacing, and the
// per-file building size mapping. These were split across Streets +
// Buildings before; consolidating them here makes "how the city is
// packed" easy to find in one place.
// ─── Streets ───────────────────────────────────────────────────────────────
function _buildStreetsSection(): HTMLElement {
  const section = _section(
    'Streets',
    'Road network sizing + packing, plus the asphalt, sidewalks, labels, footprint, and route-highlight visuals that paint on top.'
  );

  // Width tiers — step-function mapping a directory's descendant count to
  // its street width. One slider per tier so the user can fatten or thin
  // any specific road class without touching the others.
  const tierDefaults = STREET_TIERS.get();
  const tierRows = tierDefaults.map((tier, ti) => _tierWidthSlider(ti, tier.min_descendants));
  section.appendChild(_subgroup('Street width tiers', tierRows));

  section.appendChild(
    _subgroup('Street spacing', [
      _number('Sibling gap', STREET_LAYOUT, 'CHILD_GAP', 0, 50, 1, {
        tip: 'Distance between sibling children (file or subdir) packed along a street. 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably.',
      }),
      _number('Root end pad', STREET_LAYOUT, 'ROOT_END_PAD', 0, 50, 1, {
        tip: 'Fallback pad at each end of the root street (which has no parent intersection). 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably.',
      }),
      _number('Parent join pad', STREET_LAYOUT, 'PARENT_JOIN_PAD', 0, 50, 1, {
        tip: 'Extra clear space where a child street meets its parent. 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably.',
      }),
    ])
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

  // City footprint — the asphalt slab ringing the city silhouette, built
  // from every layout rect (buildings + streets + paths) inflated outward
  // by HALO_WIDTH. Defaults to the same color as Asphalt above so streets
  // bleed seamlessly into the slab. HALO_WIDTH change triggers a rebuild
  // (matrix data); COLOR + ENABLED are hot.
  section.appendChild(
    _subgroup('City footprint', [
      _toggle('Enabled', FOOTPRINT, 'ENABLED', {
        tip: 'When off, the slab is hidden (still built; group.visible = false) and tree/bush placement no longer rejects candidates inside the halo.',
      }),
      _color('Color', FOOTPRINT, 'COLOR', {
        tip: 'Slab color. Near-black by default so the apron reads as a darker frame around the city against the night-scene floor.',
      }),
      _number('Halo width', FOOTPRINT, 'HALO_WIDTH', 0, 256, 4, {
        tip: 'World units of asphalt added outward around every layout rect. ~32 (one narrow-street width) is the design default; above 256 the halo dwarfs the city and reads as a paved plaza.',
      }),
      _slider('Halo radius × halo width', FOOTPRINT, 'CORNER_RADIUS', 0, 2, 0.05, {
        tip: 'Corner radius as a fraction of Halo width above (0 = sharp, 1 = one halo width, 2 = two). World-units radius pushed to the shader = this × Halo width. Where rects overlap heavily the rounding is hidden by neighbors; the radius only shows where a rect ends at the silhouette.',
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
      _number('Font size (px)', LABEL_TYPOGRAPHY, 'FONT_SIZE_PX', 32, 512, 8, {
        tip: 'Source canvas font size. Higher = sharper close-zoom, larger texture memory. 512 fits the largest street-label canvas at maximum zoom; below 32 labels are illegible.',
      }),
      _slider('Padding × font', LABEL_TYPOGRAPHY, 'CANVAS_PADDING_FRAC', 0, 1, 0.01, {
        tip: 'Padding around glyphs on the label canvas, as a fraction of the font size.',
      }),
      _slider('Stroke × font', LABEL_TYPOGRAPHY, 'STROKE_WIDTH_FRAC', 0, 0.5, 0.01, {
        tip: 'Text outline thickness, as a fraction of the font size. 0.5 is half the natural 0–1 fraction range — above this the stroke overwhelms the glyph fill.',
      }),
      _slider('Height × street width', LABEL_TYPOGRAPHY, 'HEIGHT_FRAC', 0, 2, 0.05, {
        tip: 'Label plane height in world units, as a fraction of the street width. Wider streets get bigger labels. Labels above 2× the street width clip into adjacent rows.',
      }),
      _slider('Min fit scale', LABEL_TYPOGRAPHY, 'MIN_SCALE', 0.1, 1, 0.05, {
        tip: 'Floor for shrink-to-fit when a name is too long for its street. Labels shrink uniformly down to this fraction of natural height; below it they truncate with an ellipsis. 1 = never shrink (always truncate); 0.1 = shrink aggressively before truncating.',
      }),
      _slider('Repeat × label width', LABEL_TYPOGRAPHY, 'SPACING_MULT', 0.5, 10, 0.1, {
        tip: 'Distance between label repeats along a long street, expressed as a multiple of the label width. Below 0.5 labels overlap themselves; above 10 the street reads as unlabeled.',
      }),
      _number('Repeat floor', LABEL_TYPOGRAPHY, 'SPACING_FLOOR', 0, 1000, 10, {
        tip: 'Minimum repeat distance in world units (so tiny labels do not pile up). Beyond ~1000 world units the spacing forces labels off the visible street.',
      }),
    ])
  );

  // Selection path line — the neon line tracing gem → current selection
  // through the road network. Color cycle is shared with the building
  // outline; tweak Effects > Rainbow.
  section.appendChild(
    _subgroup('Selection path line', [
      _slider('Linewidth %', PATH_LINE, 'LINEWIDTH_PCT', 1, 50, 1, {
        tip: 'Rainbow line thickness as a % of the narrowest street width. 10% is the default; 50% fills the narrowest lane.',
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
      _slider('Linewidth %', HOVER_PATH_LINE, 'LINEWIDTH_PCT', 1, 50, 1, {
        tip: 'Preview line thickness as a % of the narrowest street width. 10% is the default; 50% fills the narrowest lane.',
      }),
      _slider('Opacity', HOVER_PATH_LINE, 'OPACITY', 0.0, 1.0, 0.05, {
        tip: 'Preview-line transparency. 0 = invisible; 1 = solid.',
      }),
    ])
  );

  // (Street width tiers + spacing live in the Layout section now — they
  // describe city packing rather than street appearance.)

  return section;
}

// ─── Buildings ─────────────────────────────────────────────────────────────
function _buildBuildingsSection(): HTMLElement {
  const section = _section(
    'Buildings',
    'Per-file boxes — height from line count, width from byte size, color from extension + age.'
  );

  section.appendChild(
    _subgroup('Building size', [
      _rangePair('Floors range', BUILDING_DIMENSIONS, 'MIN_FLOORS', 'MAX_FLOORS', 1, 200, 1, {
        tip: "How tall a building gets — represents the file's line count. Smallest file in the project lands at MIN floors; largest at MAX. Sqrt-interpolated across line counts.",
      }),
      _number('Floor height', BUILDING_DIMENSIONS, 'FLOOR_HEIGHT', 1, 50, 1, {
        tip: 'Vertical world units per floor (multiplier on the floor count above). Default is 10; above 50 the floor-to-width aspect breaks readability.',
      }),
      _rangePair('Width range', BUILDING_DIMENSIONS, 'MIN_WIDTH', 'MAX_WIDTH', 1, 200, 1, {
        tip: "How wide a building's footprint is — represents the file's byte size. Smallest file lands at MIN width; largest at MAX. Log-interpolated across byte sizes. Footprints are square (depth = width).",
      }),
      _number('Building path length', BUILDING_DIMENSIONS, 'PATH_LENGTH', 0, 50, 1, {
        tip: "Distance from the building's wall to the adjacent sidewalk. The path connector strip bridges this gap. Above 50 world units the path dominates the building footprint and the sidewalk reads as a courtyard.",
      }),
      _slider('Building path width', BUILDING_DIMENSIONS, 'PATH_WIDTH_FRAC', 0, 1, 0.05, {
        tip: "Width of the path connector strip, as a fraction of the building's own width — so big buildings get proportionally wider paths. Door is sized to ~80% of this same per-building path width.",
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('buildings-transitions', 'Transitions', () => [
      _number('Enter / refresh (ms)', ANIMATION_TIMING, 'BUILDING_TRANSITION_MS', 50, 3000, 10, {
        tip: 'Fade-in / stay duration for buildings as they enter on initial render or refresh when the manifest changes. Above 3000ms tweens feel sluggish; below 50ms reads as a hard cut.',
      }),
    ])
  );

  section.appendChild(
    _collapsibleSubgroup('buildings-palette', 'Color palette (HSL)', () => [
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
    ])
  );

  // Extension hues — one row per file extension in HUE_EXT_MAP, sorted
  // alphabetically so the list stays predictable. Each row writes back
  // to a single sub-key of HUE_EXT_MAP (no whole-map clobber). The
  // subgroup itself is a <details> so the long list can be collapsed
  // (default-closed).
  const hueDefaults = getDefault(BUILDING_PALETTE, 'HUE_EXT_MAP') || {};
  const hueExtensions = Object.keys(hueDefaults).sort();
  section.appendChild(
    _collapsibleSubgroup('extension-hues', 'Extension hues (0–359°)', () =>
      hueExtensions.map((ext) =>
        _nestedSlider(ext, BUILDING_PALETTE, 'HUE_EXT_MAP', ext, 0, 359, 1, {
          tip: 'Hue (0–359°) for files with this extension.',
          previewHue: true,
        })
      )
    )
  );

  section.appendChild(
    _collapsibleSubgroup('buildings-outlines', 'Outlines', () => [
      _number('Linewidth', BUILDING_OUTLINE, 'WIDTH', 1, 10, 1, {
        tip: 'Pixel thickness shared by per-building, hover, and selected outlines. Above 10 pixels the wireframe occludes facade detail; below 1 it vanishes at typical zoom.',
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

  section.appendChild(
    _collapsibleSubgroup('buildings-ads', 'Ad panels (media files)', () => [
      _slider('Side margin × width', AD_PANEL, 'AD_SIDE_MARGIN_FRAC', 0, 0.4, 0.01, {
        tip: 'Horizontal margin on each side of the building width — controls how much building wall is visible to the left and right of the ad. Above 0.4 the margins consume more than 80% of the face and the ad becomes a sliver.',
      }),
      _slider('Bottom offset × floors', AD_PANEL, 'AD_BOTTOM_OFFSET_FLOORS', 0, 3, 0.1, {
        tip: 'Ad bottom edge sits this many floor heights above the ground — guarantees the door (0.75 of a floor tall) stays uncovered. 1.0 leaves a clean strip; raise it to lift the ad higher on the building.',
      }),
      _slider('Front-face offset', AD_PANEL, 'AD_OFFSET', 0, 0.2, 0.005, {
        tip: 'How far in front of the building face the ad plane sits — small z-offset to avoid z-fighting with the wall. Above 0.2 the ad noticeably floats away from the building.',
      }),
      _color('Placeholder color', AD_PANEL, 'AD_PLACEHOLDER_COLOR', {
        tip: 'Color shown on the ad plane while the texture is loading (or if the load fails).',
      }),
    ])
  );

  // Facade parent — geometry, contrast, and window lighting share the
  // "what the building's surface looks like" mental model, so we collapse
  // them under one default-closed parent. Each child stays a regular
  // _subgroup; _collapsibleSubgroup's `buildRows` already accepts any
  // HTMLElement, so subgroups work as children with no helper changes.
  section.appendChild(
    _collapsibleSubgroup('facade', 'Facade', () => [
      _subgroup('Geometry', [
        _slider('Slab thickness × floor', FACADE_GEOMETRY, 'SLAB_HEIGHT_FRAC', 0, 0.4, 0.01, {
          tip: "Floor-slab strip height as a fraction of one floor. Above 0.4 the slab eats more than the floor's window band — the facade reads as horizontal banding instead of windowed.",
        }),
        _slider('Window width × cell', FACADE_GEOMETRY, 'WINDOW_WIDTH_FRAC', 0, 1, 0.01, {
          tip: 'Window width as a fraction of its grid cell.',
        }),
        _slider('Window height × floor', FACADE_GEOMETRY, 'WINDOW_HEIGHT_FRAC', 0, 1, 0.01, {
          tip: 'Window height as a fraction of one floor.',
        }),
        _slider('Window margin × face', FACADE_GEOMETRY, 'WINDOW_MARGIN_FRAC', 0, 0.2, 0.005, {
          tip: 'Horizontal margin per edge of the window grid, as a fraction of face width. Above 0.2 there is only room for ~3 window columns on a typical building.',
        }),
        _slider('Door height × floor', FACADE_GEOMETRY, 'DOOR_HEIGHT_FRAC', 0, 1, 0.01, {
          tip: 'Door height as a fraction of one floor.',
        }),
        _slider('Roof border × face', FACADE_GEOMETRY, 'ROOF_BORDER_FRAC', 0, 0.1, 0.005, {
          tip: 'Width of the roof border strip, as a fraction of the face. Above 0.1 (10% of face width) the border eats into the icon area at the top of the facade.',
        }),
        _number('Max window columns', FACADE_GEOMETRY, 'WINDOW_COLS_MAX', 1, 10, 1, {
          tip: 'Hard cap on window columns per face. Rebuild required. Above 10 the window grid becomes too dense to read at typical zoom.',
        }),
        _number('Width per window col', FACADE_GEOMETRY, 'WIDTH_PER_WINDOW_COL', 1, 32, 1, {
          tip: 'World-unit width allotted per window column (cols = floor(buildingWidth / this)). Rebuild required. Above 32 world units per column, small buildings end up with zero windows.',
        }),
        _slider('Door width × path', FACADE_GEOMETRY, 'DOOR_WIDTH_FRAC_OF_PATH', 0, 1, 0.01, {
          tip: 'Door width as a fraction of the building path width. Rebuild required.',
        }),
      ]),
      _subgroup('Contrast (HSL lightness Δ)', [
        _slider('Floor slab', FACADE_DETAIL, 'SLAB_LIGHTNESS_DELTA', -100, 100, 1, {
          tip: 'Lightness offset for the floor-slab strip, in HSL percentage points (negative darkens).',
        }),
        _slider('Door', FACADE_DETAIL, 'DOOR_LIGHTNESS_DELTA', -100, 100, 1, {
          tip: 'Lightness offset for the door (negative darkens).',
        }),
        _slider('Roof border', FACADE_DETAIL, 'ROOF_BORDER_LIGHTNESS_DELTA', -100, 100, 1, {
          tip: 'Lightness offset for the roof border strip (negative darkens).',
        }),
      ]),
      _subgroup('Window lighting', [
        _slider('Unlit pane lightness Δ', WINDOW_LIGHTING, 'UNLIT_LIGHTNESS_DELTA', -20, 20, 1, {
          tip: 'HSL lightness offset applied to unlit panes (relative to the building hue).',
        }),
        _slider('Gap fraction (base)', WINDOW_LIGHTING, 'GAP_BASE_THRESHOLD', 0, 1, 0.01, {
          tip: 'Base fraction of cells with no window at all (architectural gaps).',
        }),
        _slider('Gap fraction (age bonus)', WINDOW_LIGHTING, 'GAP_AGE_BONUS', 0, 1, 0.01, {
          tip: 'Extra empty-cell fraction added for the oldest building (interpolates down to 0 for the newest).',
        }),
        _slider('Lit-window dim curve', WINDOW_LIGHTING, 'LIT_FRESHNESS_EXPONENT', 1, 4, 0.1, {
          tip: 'Exponent on the recency curve that drives lit-window count + HDR emission. 1 = linear; higher dims mid-age buildings faster so only the freshest ones glow. Beyond 4 only the newest ~6% of files visibly emit (exponent applied to recency).',
        }),
        _color('Old building glow', WINDOW_LIGHTING, 'DIM_GLOW_COLOR', {
          tip: 'Warm-amber tint that lit panes drift toward as the file ages (created-date axis, not last-modified).',
        }),
      ]),
    ])
  );

  // Aging parent — grime streaks + tilt both key off createdAge.
  // Default-closed; small, niche group of weathering knobs.
  section.appendChild(
    _collapsibleSubgroup('aging', 'Aging', () => [
      _subgroup('Grime streaks', [
        _toggle('Enabled', BUILDING_AGING, 'GRIME_ENABLED', {
          tip: 'Vertical streaks of darker color falling from the top of each face on aged buildings. Off → clean facades regardless of age.',
        }),
        _slider('Intensity', BUILDING_AGING, 'GRIME_INTENSITY', 0, 1, 0.05, {
          tip: 'How dark each streak gets. 0 = invisible; 1 = strongly darkened wall color.',
        }),
        _slider('Coverage', BUILDING_AGING, 'GRIME_COVERAGE', 0, 1, 0.05, {
          tip: 'Fraction of vertical bands the oldest building shows as streaky. Lower = sparser streaks; higher = nearly every band weathers.',
        }),
      ]),
      _subgroup('Tilt', [
        _toggle('Enabled', BUILDING_AGING, 'TILT_ENABLED', {
          tip: 'Small lean around the base, proportional to createdAge. Each building leans in a stable hashed direction. Off → all buildings stand perfectly upright.',
        }),
        _slider('Max degrees', BUILDING_AGING, 'TILT_DEGREES', 0, 10, 0.1, {
          tip: 'Maximum lean angle (degrees) applied to the oldest building. Newer buildings interpolate down to 0. Above 10° buildings visually clip into their neighbors.',
        }),
      ]),
    ])
  );

  // Selection fade parent — per-tier style. Each tier (Default =
  // siblings of selection / Level 1 = one hop / Level 2+ = far) gets
  // four controls: detail (full / silhouette / hidden), outline on/off,
  // and separate body + outline opacity sliders. Hover renders a
  // building using the Default tier's settings — no separate hover-floor
  // knob. Default-closed; 3 children, niche.
  const DETAIL_OPTIONS = [
    { value: FadeDetail.Full, label: 'Full' },
    { value: FadeDetail.Silhouette, label: 'Silhouette' },
    { value: FadeDetail.Hidden, label: 'Hidden' },
  ];
  section.appendChild(
    _collapsibleSubgroup('selection-fade', 'Selection fade', () => [
      _subgroup('Default tier — siblings of selection', [
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
      ]),
      _subgroup('Level 1 — one hop from selection', [
        _select('Detail', BUILDING_FADE, 'NEAR_DETAIL', DETAIL_OPTIONS, {}),
        _toggle('Outline', BUILDING_FADE, 'NEAR_OUTLINE', {}),
        _slider('Body opacity', BUILDING_FADE, 'NEAR_BODY_OPACITY', 0.0, 1.0, 0.05, {}),
        _slider('Outline opacity', BUILDING_FADE, 'NEAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {}),
      ]),
      _subgroup('Level 2+ — cousins, deeper subtrees', [
        _select('Detail', BUILDING_FADE, 'FAR_DETAIL', DETAIL_OPTIONS, {}),
        _toggle('Outline', BUILDING_FADE, 'FAR_OUTLINE', {}),
        _slider('Body opacity', BUILDING_FADE, 'FAR_BODY_OPACITY', 0.0, 1.0, 0.05, {}),
        _slider('Outline opacity', BUILDING_FADE, 'FAR_OUTLINE_OPACITY', 0.0, 1.0, 0.05, {}),
      ]),
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
        tip: 'Floor for narrow root streets so the gem stays visible. Below 1 the gem vanishes; above 50 it dwarfs the root plaza.',
      }),
      _slider('Hover lift × street width', GEM_SIZING, 'HOVER_LIFT_FRAC', 0, 2, 0.05, {
        tip: 'Extra vertical lift above the road, on top of the gem radius. Above 2× the gem radius it floats clearly off the ground into the void.',
      }),
      _slider('Plaza × gem width', GEM_SIZING, 'CLEARANCE_AS_GEM_WIDTH_FRAC', 0, 5, 0.1, {
        tip: "Dead-space pad past the gem at the root street's origin end, expressed as a multiple of the gem's diameter. 2 = plaza is two gem-widths long. Above 5× gem-width the plaza dominates the visible root street.",
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
        tip: 'Size of the inner "hot core" halo, as a multiple of the gem radius. Larger = bigger soft disk. Beyond 12× radius the inner core overlaps the outer halo.',
      }),
      _slider('Inner opacity', GEM_GLOW, 'INNER_OPACITY', 0, 1, 0.05, {
        tip: 'Brightness of the hot core. Lower for a subtler halo.',
      }),
      _slider('Outer scale × radius', GEM_GLOW, 'OUTER_SCALE', 1, 30, 0.5, {
        tip: 'Size of the outer atmospheric halo. Much larger than the inner one so the falloff reaches far past the gem. Beyond 30× radius the outer halo extends past the typical camera frame.',
      }),
      _slider('Outer opacity', GEM_GLOW, 'OUTER_OPACITY', 0, 1, 0.05, {
        tip: 'Brightness of the atmospheric halo.',
      }),
      _toggle('Animate colors', GEM_GLOW, 'ANIMATE_COLORS', {
        tip: 'Cycle the halo color through the gem face palette. Off = halo uses the edge color from Appearance above.',
      }),
      _slider('Cycle period (s)', GEM_GLOW, 'CYCLE_PERIOD_SECONDS', 1, 30, 0.5, {
        tip: 'Seconds for one full pass through every palette color. Below 1s reads as flicker; above 30s the cycle feels static.',
      }),
    ])
  );

  section.appendChild(
    _subgroup('Animation', [
      _slider('Rotation speed', GEM_ANIMATION, 'ROTATION_SPEED', 0, 3, 0.05, {
        tip: 'Radians per second. Above 3 rad/sec the gem looks frantic.',
      }),
      _slider('Bob frequency', GEM_ANIMATION, 'BOB_FREQUENCY', 0, 5, 0.1, {
        tip: 'How fast the gem oscillates vertically. Above 5 cycles/sec it reads as vibration, not bobbing.',
      }),
      _slider('Bob amplitude', GEM_ANIMATION, 'BOB_AMPLITUDE_FRAC', 0, 2, 0.05, {
        tip: 'Vertical bob distance, as a fraction of the gem radius. Above 2× radius the gem flies off the street.',
      }),
      _slider('Hover scale', GEM_ANIMATION, 'HOVER_SCALE', 1, 3, 0.05, {
        tip: 'Multiplier applied to the gem when the cursor is over it. Above 3× the gem dominates the scene on hover.',
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
  const section = _section(
    'Effects',
    'Shared visual effects + per-cell level-of-detail thresholds.'
  );

  section.appendChild(
    _subgroup('Rainbow (selected outline + path line)', [
      _slider('Speed', RAINBOW, 'SPEED', 0, 0.005, 0.0001, {
        tip: 'Hue cycles per millisecond. The shared rainbow chases around the selected building outline AND the gem→selection path line.',
      }),
      _slider('Saturation', RAINBOW, 'SATURATION', 0, 1, 0.05, {}),
      _slider('Lightness', RAINBOW, 'LIGHTNESS', 0, 1, 0.05, {}),
    ])
  );

  section.appendChild(
    _subgroup('Bloom (HDR neon glow)', [
      _toggle('Enabled', BLOOM, 'ENABLED', {
        tip: 'Off → bloom pass bypassed AND windows/gem stay LDR — approximates the pre-HDR "flat" look for side-by-side comparison. Other knobs stay in config.',
      }),
      _slider('Window emission', BLOOM, 'WINDOW_EMISSION', 0, 3.0, 0.05, {
        tip: "Peak HDR push for the freshest building's lit windows; scales linearly down to 0 for the oldest. The bloom pass's strength × radius then operates on that age-scaled HDR signal, so total glow tracks building age. 0 = no bloom from windows; 1 = moderate; 3 = full neon.",
      }),
      _slider('Gem emission', BLOOM, 'GEM_EMISSION', 0, 5.0, 0.1, {
        tip: "Multiplier on the root-gem's halo sprite colors. 0 = halos black (invisible); 1 = LDR (no bloom from gem); higher = HDR push that drives selective bloom on the gem, independent of Window emission.",
      }),
      _slider('Ad emission', BLOOM, 'AD_EMISSION', 0, 5.0, 0.1, {
        tip: 'Multiplier on ad panel colors. Bright pixels in the texture push past 1.0 and bloom; dark pixels stay below threshold. 0 = panel black; 1 = LDR (no bloom); higher = neon storefront.',
      }),
      _slider('Strength', BLOOM, 'STRENGTH', 0, 1, 0.01, {
        tip: 'Overall bloom intensity multiplier. 0 = bloom pass produces nothing; 1 = full strength.',
      }),
      _slider('Radius', BLOOM, 'RADIUS', 0, 1.0, 0.05, {
        tip: "How far each bright pixel's glow spreads. Lower = tighter halos; higher = soft diffuse glow.",
      }),
      _slider('Threshold (cutoff)', BLOOM, 'THRESHOLD', 0, 2.0, 0.05, {
        tip: 'Luma CUTOFF — pixels below this value contribute nothing to bloom. NOT an intensity dial: lower threshold = more pixels qualify = more total bloom; higher = fewer pixels glow. ≥1.0 keeps matte walls (capped at 1.0) clean and only blooms the HDR-pushed window pixels.',
      }),
    ])
  );

  return section;
}

// ─── File Preview ──────────────────────────────────────────────────────────
// File-preview sidebar settings. Currently just the syntax highlight theme
// picker: a native <select> that writes directly to SYNTAX_THEME (no draft
// layer — the CSS link swaps instantly, no Save required).
function _buildFilePreviewSection(): HTMLElement {
  const section = _section('File Preview', 'Syntax highlight theme for the code preview pane.');

  // Native <select> — 8 theme options don't suit the segmented button style.
  const sel = document.createElement('select');
  sel.className = 'form-input form-input--select';
  for (const opt of SYNTAX_THEME_OPTIONS) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    sel.appendChild(el);
  }

  sel.addEventListener('change', () => {
    SYNTAX_THEME.set(sel.value);
  });

  // Reset button — mirrors the rotate-ccw affordance other rows use, but
  // wired to the SYNTAX_THEME atom (not the drafts layer, which the rest
  // of Controls uses). Disabled when the current value already matches the
  // default; clicking writes the default back into the atom.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'theme-row-reset';
  resetBtn.title = `Default: ${SYNTAX_THEME_OPTIONS.find((o) => o.value === SYNTAX_THEME_DEFAULT)?.label ?? SYNTAX_THEME_DEFAULT}`;
  resetBtn.setAttribute('aria-label', 'Reset syntax theme to default');
  resetBtn.appendChild(makeLucideIcon('rotate-ccw'));
  resetBtn.addEventListener('click', (e) => {
    if (resetBtn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    SYNTAX_THEME.set(SYNTAX_THEME_DEFAULT);
  });

  // Sync <select> value AND reset-button disabled state with the atom
  // (covers initial hydration, external resets such as "Reset all", and
  // every user change via this same select).
  const refresh = () => {
    const v = SYNTAX_THEME.get();
    sel.value = v;
    resetBtn.disabled = v === SYNTAX_THEME_DEFAULT;
  };
  SYNTAX_THEME.subscribe(refresh);

  const row = document.createElement('label');
  row.className = 'theme-row';
  const lbl = document.createElement('span');
  lbl.className = 'theme-row-label';
  lbl.textContent = 'Syntax theme';
  row.appendChild(lbl);
  const ctrl = document.createElement('span');
  ctrl.className = 'theme-row-control';
  ctrl.appendChild(sel);
  ctrl.appendChild(resetBtn);
  row.appendChild(ctrl);
  section.appendChild(row);

  return section;
}

// ─── Debug ─────────────────────────────────────────────────────────────────
// Developer-only diagnostics. Collapsibility (and persisted open/closed
// state) comes from the shared `_section()` helper. Buttons are rendered
// only when their callback is provided; either or both may be present.
function _buildDebugSection(
  onRunCollisionCheck: (() => void) | undefined,
  onRunStemDiagnostic: (() => void) | undefined
): HTMLElement {
  const section = _section(
    'Debug',
    'Developer-only diagnostics. Output goes to the browser console.',
    false
  );

  if (onRunCollisionCheck) {
    const row = document.createElement('div');
    row.className = 'theme-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
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
    button.className = 'btn-secondary';
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
// the existing persist + commit-reaction subscriptions). Discard drops pending
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
  resetAll.className = 'btn-secondary controls-button';
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
  discard.className = 'btn-secondary controls-button';
  discard.textContent = 'Discard';
  discard.title = 'Drop all unsaved changes.';
  discard.addEventListener('click', () => {
    if (discard.disabled) return;
    discardDrafts();
  });
  right.appendChild(discard);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-primary controls-button';
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
          if (
            !_isEqual(
              getEffective(store as MapLikeStore, k),
              (defaults as Record<string, unknown>)[k]
            )
          ) {
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

function _section(name: string, hint?: string, _defaultOpen = true): HTMLElement {
  const section = document.createElement('details');
  section.className = 'controls-section';

  // Open/closed state is intentionally NOT persisted. The left sidebar resets
  // all <details> to closed each time the Controls tab becomes visible, so the
  // panel always opens fresh. _defaultOpen is kept as a parameter for call-site
  // compatibility but has no effect — all sections start collapsed.

  const summary = document.createElement('summary');
  summary.className = 'row row--bleed controls-section-summary';
  // Lucide chevron, rotated via CSS on [open] — matches the file tree
  // accordion's visual language (Lucide icon + currentColor mask) rather
  // than the previous unicode triangle.
  const chevron = makeLucideIcon('chevron-right', { class: 'controls-section-chevron' });
  summary.appendChild(chevron);
  const label = document.createElement('span');
  label.className = 'text-label';
  label.textContent = name;
  summary.appendChild(label);

  // Section-level reset — stages defaults for every row in this section in
  // one click. Uses the per-row `.theme-row-reset` buttons (already wired to
  // their own store + keys) as the registry, so we don't need to track which
  // stores belong to which section. Enabled iff ANY child row differs from
  // its default (i.e., at least one row reset is enabled). Sub-accordions
  // are NOT given their own reset — only top-level sections via this helper.
  const sectionReset = document.createElement('button');
  sectionReset.type = 'button';
  sectionReset.className = 'controls-section-reset';
  sectionReset.title = 'Reset all values in this section to defaults';
  sectionReset.setAttribute('aria-label', 'Reset section to defaults');
  sectionReset.appendChild(makeLucideIcon('rotate-ccw'));
  sectionReset.addEventListener('click', (e) => {
    e.preventDefault();
    // Without stopPropagation the <summary> click would toggle the <details>
    // open state. The user clicked reset, not the section.
    e.stopPropagation();
    if (sectionReset.disabled) return;
    const rowResets = section.querySelectorAll<HTMLButtonElement>('.theme-row-reset');
    rowResets.forEach((b) => {
      if (!b.disabled) b.click();
    });
  });
  summary.appendChild(sectionReset);

  function _doRefreshSectionReset() {
    const rowResets = section.querySelectorAll<HTMLButtonElement>('.theme-row-reset');
    // If the section has no resettable rows at all (e.g. Keyboard & mouse,
    // Debug), there's nothing this button could do — hide it entirely
    // rather than render a permanently-disabled affordance.
    if (rowResets.length === 0) {
      sectionReset.style.display = 'none';
      return;
    }
    sectionReset.style.display = '';
    // Enabled = at least one row's reset is enabled (i.e., that row differs
    // from default).
    sectionReset.disabled = !Array.from(rowResets).some((b) => !b.disabled);
  }

  // Queue the actual refresh into a microtask so it runs AFTER every per-row
  // reset has already updated its own `disabled` state for the same store /
  // draft event. The section subscribes BEFORE the rows do (sections are
  // built before their rows are appended), so reading button.disabled
  // synchronously would otherwise see stale values from the previous tick.
  let _scheduled = false;
  function refreshSectionReset() {
    if (_scheduled) return;
    _scheduled = true;
    queueMicrotask(() => {
      _scheduled = false;
      _doRefreshSectionReset();
    });
  }

  // First refresh runs after the caller has appended rows (same microtask
  // guarantee — the section is built synchronously by callers like
  // _buildBuildingsSection, so by the time the microtask fires, all rows
  // are in place AND have wired their own subscribers).
  refreshSectionReset();
  // Subsequent refreshes ride on the same hooks the per-row resets use, so
  // the section button always stays in sync with the rows.
  subscribeDrafts(refreshSectionReset);
  onAnyChange(refreshSectionReset);

  section.appendChild(summary);

  if (hint) {
    const h = document.createElement('div');
    h.className = 'controls-section-hint';
    h.textContent = hint;
    section.appendChild(h);
  }
  return section;
}

// `rows` accepts either an array of row elements (the common case) or a
// single element — used by the shortcuts list, whose body is one <dl> rather
// than a stack of _row() outputs.
function _subgroup(name: string, rows: HTMLElement[] | HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'theme-subgroup';
  const h = document.createElement('div');
  h.className = 'text-label text-label--muted';
  h.textContent = name;
  wrap.appendChild(h);
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) wrap.appendChild(row);
  return wrap;
}

// _collapsibleSubgroup — same visual shell as _subgroup but the body is
// wrapped in a <details> so users can collapse long lists (e.g. the per-
// extension hue rows) OR nested groups (e.g. Buildings > Facade, which
// contains three child _subgroup()s). `buildRows` returns HTMLElements
// that are appended directly — they can be _row() outputs, _subgroup()
// outputs, or even nested _collapsibleSubgroup()s. Default-closed;
// open/closed state persists per `slug` in localStorage. `buildRows` is
// invoked lazily on first construction so we don't build expensive rows
// the user may never see — though in practice the rows are cheap and
// built eagerly the first time.
function _collapsibleSubgroup(
  _slug: string,
  name: string,
  buildRows: () => HTMLElement[]
): HTMLElement {
  const details = document.createElement('details');
  details.className = 'theme-subgroup theme-subgroup-collapsible';

  // Open/closed state is intentionally NOT persisted — the panel resets all
  // <details> to closed each time it becomes visible.
  details.open = false;

  const summary = document.createElement('summary');
  summary.className = 'row row--bleed text-label text-label--muted';
  // Lucide chevron matched to the section accordion's chevron — same
  // family as the file tree's expand/collapse glyph.
  const chevron = makeLucideIcon('chevron-right', { class: 'theme-subgroup-chevron' });
  summary.appendChild(chevron);
  const labelSpan = document.createElement('span');
  labelSpan.className = 'theme-subgroup-label-text';
  labelSpan.textContent = name;
  summary.appendChild(labelSpan);

  // Group-level reset — stages defaults for every row inside this subgroup
  // (recursive — nested subgroups' rows are included). Uses the per-row
  // `.theme-row-reset` buttons as the registry, same approach as the
  // section-level reset in _section(). Hidden when no descendant row has a
  // reset (e.g. shortcut-list subgroups). Disabled when every descendant
  // row is already at its default.
  const groupReset = document.createElement('button');
  groupReset.type = 'button';
  groupReset.className = 'controls-subgroup-reset';
  groupReset.title = `Reset all values in ${name} to defaults`;
  groupReset.setAttribute('aria-label', 'Reset group to defaults');
  groupReset.appendChild(makeLucideIcon('rotate-ccw'));
  groupReset.addEventListener('click', (e) => {
    // Without preventDefault + stopPropagation the <summary> click would
    // toggle the <details> open state. The user clicked reset, not the
    // group header.
    e.preventDefault();
    e.stopPropagation();
    if (groupReset.disabled) return;
    const rowResets = details.querySelectorAll<HTMLButtonElement>('.theme-row-reset');
    rowResets.forEach((b) => {
      if (!b.disabled) b.click();
    });
  });
  summary.appendChild(groupReset);

  details.appendChild(summary);

  for (const row of buildRows()) details.appendChild(row);

  function _doRefreshGroupReset() {
    const rowResets = details.querySelectorAll<HTMLButtonElement>('.theme-row-reset');
    if (rowResets.length === 0) {
      groupReset.style.display = 'none';
      return;
    }
    groupReset.style.display = '';
    // Enabled = at least one row's reset is enabled (i.e., that row differs
    // from default).
    groupReset.disabled = !Array.from(rowResets).some((b) => !b.disabled);
  }

  // Queue the actual refresh into a microtask so it runs AFTER every per-row
  // reset has already updated its own `disabled` state for the same store /
  // draft event. Same ordering trick the section-level reset uses.
  let _scheduled = false;
  function refreshGroupReset() {
    if (_scheduled) return;
    _scheduled = true;
    queueMicrotask(() => {
      _scheduled = false;
      _doRefreshGroupReset();
    });
  }

  // Initial refresh: per-row reset buttons have already called their own
  // synchronous refresh() (inside _makeResetButton), so we can read their
  // `disabled` state directly. Call _doRefreshGroupReset() synchronously
  // here rather than queuing a microtask — this avoids the button starting
  // as enabled (the browser default) in environments that don't flush
  // microtasks before the caller inspects the DOM (e.g. unit tests).
  _doRefreshGroupReset();
  // Subsequent refreshes still use the microtask scheduler so this button
  // reads per-row state AFTER those buttons have processed the same event.
  subscribeDrafts(refreshGroupReset);
  onAnyChange(refreshGroupReset);

  return details;
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
    btn.disabled = keys.every((k) => _isEqual(getEffective(store, k), getDefault(store, k)));
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
  input.className = 'form-input form-input--mono';
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
    256,
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
    tip: 'World-unit width for streets in this descendant-count tier. Above ~256 streets overwhelm building footprints; below 1 they disappear.',
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
    const current = (getEffective(store, parentKey) as Record<string, unknown>) || {};
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
    btn.className = 'btn-toggle btn-toggle--separated';
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

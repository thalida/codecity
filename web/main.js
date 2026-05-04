// main.js — Entry point. Fetches the manifest from the local Python server
// at /api/manifest, lays out the city, builds the scene, and starts the
// render loop with orbit/pan/zoom controls and raycast picking.

import * as THREE from 'three';
import { listenKeys } from 'nanostores';
import './styles.css';

import * as Config from './config/index.js';
import {
  BUILDING_PALETTE,
  SCENE_COLORS,
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  GEM_ANIMATION,
  GEM_APPEARANCE,
  GEM_SIZING,
  INPUT_TIMING,
  LIVE_UPDATES,
  POLL_SECONDS_MIN,
  POLL_SECONDS_MAX
} from './config/index.js';
import { attachPersistence, persistStore } from './config/_persist.js';
import { NODE_KIND, DOM_IDS, STREET_AXIS } from './constants.js';

import { regenerateLabelTexture } from './scene/engine.js';
import { createCityScene } from './scene/cityScene.js';
import { createCameraRig } from './scene/cameraRig.js';
import { createPicker, PICKER_SELECTION_KEY } from './interaction/picker.js';
import { createBuildingFader } from './interaction/buildingFader.js';
import { createOutlineRenderer } from './interaction/outlineRenderer.js';
import { createPathLineRenderer } from './interaction/pathLineRenderer.js';
import { showFileSidebar, showDirSidebar, showEmptySidebar, hideSidebar, humanLanguageFor } from './components/sidebar.js';
import { initAppHeader } from './components/appHeader.js';
import { initAppFooter } from './components/appFooter.js';
import { showLeftSidebar } from './components/leftSidebar.js';
import { showTooltip, hideTooltip } from './components/tooltip.js';


function startRenderLoop(canvas, manifest) {
  // Every visual / layout tunable comes from the named exports of
  // src/defaults.js. Render-loop code reads them fresh each frame (or
  // each event), so the Settings UI can mutate the imported objects in
  // place and changes take effect immediately. Material-level
  // applications (line widths, hex color caches, scene background) are
  // re-synced via applyTheme() — exposed to the Settings UI through
  // showLeftSidebar().

  // -- 1. Config + sidebar pump ------------------------------------------------
  var huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};

  // ── Sidebar render pump ───────────────────────────────────────────────
  // Two independent pieces of state drive the right sidebar:
  //   • sidebarVisible — is the panel showing at all? (header toggle)
  //   • currentSelection — what's selected? (city click, tree click, Esc, …)
  // _renderSidebar() is the single place that combines them and updates
  // the DOM. Every input that changes either flag calls it.
  var sidebarVisible = false;   // set from appHeader's persisted state below

  function _renderSidebar() {
    if (!sidebarVisible) {
      hideSidebar();
      return;
    }
    if (!currentSelection) {
      showEmptySidebar();
      return;
    }
    if (currentSelection.kind === NODE_KIND.FILE) {
      showFileSidebar(currentSelection.file);
    } else if (currentSelection.kind === NODE_KIND.DIRECTORY) {
      showDirSidebar(currentSelection.dir);
    }
  }

  // Sitewide header owns the chip + clickable breadcrumb + copy + the
  // show/hide-sidebar toggles. Breadcrumb segment clicks come back here
  // so we can route them through _setSelection (the same entry point
  // canvas / tree clicks use). The breadcrumb always leads with the
  // project root (manifest.tree.name → segment with path manifest.tree.path).
  var appHeader = initAppHeader({
    huePalette:     huePalette,
    rootLabel:      (manifest.tree && manifest.tree.name) || '',
    rootPath:       (manifest.tree && manifest.tree.path) || '',
    onSegmentClick: function (path) { _selectByPath(path); },
    onRightToggle: function (hidden) {
      sidebarVisible = !hidden;
      _renderSidebar();
    },
  });
  sidebarVisible = appHeader.isRightVisible();
  // Initial header render so the root segment is visible from boot
  // (before any selection happens).
  appHeader.setSelection(null);

  // Sitewide footer — the per-file/dir status strip. Used to live inside
  // the right sidebar; lifted out so it's always visible and doesn't get
  // torn down when the right sidebar collapses. Boots showing the root
  // dir's totals so the bar is never blank, even before a selection.
  var appFooter = initAppFooter();
  var rootDir = manifest.tree || {};
  appFooter.setSelection({
    kind:  'directory',
    files: rootDir.descendants_file_count || 0,
    dirs:  rootDir.descendants_dir_count  || 0,
    size:  rootDir.descendants_size       || 0,
  });

  // Initial render so the boot state matches sidebarVisible. Without this
  // a visible-by-default right sidebar would still show as 0-width on
  // first load (no .open class until something fires _renderSidebar).
  _renderSidebar();

  // -- 2. City scene + meshes --------------------------------------------------
  // Manifest-bound state — meshes, lookup maps, outlines, ghosts — lives
  // in scene/cityScene.js. main.js holds local cached views of the alive
  // arrays, refreshed via cityScene.onChange after each applyManifest.
  // These caches are a transitional pattern: subsequent commits migrate
  // their consumers (picker, fader, outlineRenderer, …) into modules
  // that read cityScene directly, eliminating these refs.
  var cityScene = createCityScene(canvas);
  var scene = cityScene.scene;

  var buildingMeshes, streetPickables, streetLabels, pathMeshes, asphaltMeshes;
  var rootGem, rootGemBody, rootGemEdges, rootStreet, gemWorldPos, bbox;
  var layout, dateRanges;
  var buildingOutlines, buildingOutlineMats, buildingGhosts;
  var sidewalksByDirPath, streetsByDirPath, buildingsByPath, pathMeshesByDirPath;

  function _syncFromCityScene() {
    buildingMeshes      = cityScene.getBuildings();
    streetPickables     = cityScene.getStreetPickables();
    streetLabels        = cityScene.getStreetLabels();
    pathMeshes          = cityScene.getPathMeshes();
    asphaltMeshes       = cityScene.getAsphaltMeshes();
    rootGem             = cityScene.getRootGem();
    rootGemBody         = cityScene.getRootGemBody();
    rootGemEdges        = cityScene.getRootGemEdges();
    rootStreet          = cityScene.getRootStreet();
    gemWorldPos         = cityScene.getGemWorldPos();
    bbox                = cityScene.getBbox();
    layout              = cityScene.getLayout();
    dateRanges          = cityScene.getDateRanges();
    buildingOutlines    = cityScene.getBuildingOutlines();
    buildingOutlineMats = cityScene.getBuildingOutlineMats();
    buildingGhosts      = cityScene.getBuildingGhosts();
    sidewalksByDirPath  = cityScene.getSidewalksByDirMap();
    streetsByDirPath    = cityScene.getStreetsByDirMap();
    buildingsByPath     = cityScene.getBuildingsByPath();
    pathMeshesByDirPath = cityScene.getPathConnectorsMap();
  }
  cityScene.onChange(_syncFromCityScene);
  cityScene.applyManifest(manifest);    // populates state via onChange above

  // Hot-reload the label fill color: FILL is baked into the CanvasTexture
  // at scene-build, so a "live" change requires regenerating each label's
  // texture. listenKeys fires only when FILL specifically changes (not on
  // every applyTheme call), so unrelated tweaks don't pay the texture
  // regen cost. Reads streetLabels fresh from cityScene each fire so
  // it works after applyManifest rebinds the array.
  listenKeys(LABEL_TYPOGRAPHY, ['FILL'], function () {
    var labels = cityScene.getStreetLabels();
    for (var li = 0; li < labels.length; li++) {
      regenerateLabelTexture(labels[li]);
    }
  });

  // -- 3. Renderer -------------------------------------------------------------
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  _resizeRendererToCanvas(renderer, canvas);

  // -- 4. Camera + controls ----------------------------------------------------
  // Camera, OrbitControls, pose persistence, framing, and the focus/reset
  // animations all live in scene/cameraRig.js. Local aliases are kept for
  // brevity in event handlers and resize logic below.
  var rig = createCameraRig({ canvas: canvas, cityScene: cityScene });
  var camera = rig.camera;

  // -- 5. Picker (raycaster + hover/selection state) --------------------------
  // Picker owns the hover + selection atoms (consumed below by the
  // outline / path-line / fader / sidebar code via subscription).
  // Selection persistence is wired in the boot block before startRenderLoop
  // runs — the saved {kind, path} key is hydrated into PICKER_SELECTION_KEY
  // before this picker resolves it against the freshly-built city.
  var picker = createPicker({ canvas: canvas, camera: camera, cityScene: cityScene });

  // -- 6. Per-frame visual modules ---------------------------------------------
  // Three siblings, all subscribed to picker / cityScene so they react
  // to selection / hover / manifest changes on their own. Animate loop
  // drives them in field-ownership order: fader writes body opacity →
  // outlineRenderer reads outlineOp/ghostOp from userData and writes
  // outline + ghost opacity → pathLineRenderer ticks the rainbow chase
  // on the selection line.
  var fader            = createBuildingFader({ cityScene: cityScene, picker: picker });
  var outlineRenderer  = createOutlineRenderer({
    canvas: canvas, scene: scene, cityScene: cityScene, picker: picker,
  });
  var pathLineRenderer = createPathLineRenderer({
    canvas: canvas, scene: scene, cityScene: cityScene, picker: picker,
  });

  // Click vs. drag: track pointerdown→pointerup with a movement + time threshold.
  var downX = 0, downY = 0, downTime = 0;

  // Hover + selected outline meshes, per-building outline + ghost
  // updates, and the rainbow chase live in interaction/outlineRenderer.js.
  // The fade-tier decision (which buildings dim, which stay opaque)
  // lives in interaction/buildingFader.js. The neon path line lives in
  // interaction/pathLineRenderer.js.

  // Sidewalk tint colors. Each street's sidewalk material starts at
  // config.scene.sidewalk; we mutate material.color directly on hover/select
  // and restore from sidewalk.userData.origColor (lazily captured first time
  // we touch the material).
  // Sidewalk tint hex caches. SIDEWALK_COLORS holds CSS strings; we
  // pre-convert to numeric hex so the per-frame tint loop can call
  // material.color.setHex() without re-parsing every frame. applyTheme()
  // refreshes these whenever the Settings UI mutates SIDEWALK_COLORS.
  var _swc0 = SIDEWALK_COLORS.get();
  var SIDEWALK_HOVER_COLOR    = new THREE.Color(_swc0.HOVER).getHex();
  var SIDEWALK_SELECTED_COLOR = new THREE.Color(_swc0.SELECTED).getHex();
  var SIDEWALK_DEFAULT_COLOR  = new THREE.Color(_swc0.DEFAULT).getHex();

  // Lookup maps (sidewalksByDirPath, streetsByDirPath, buildingsByPath,
  // pathMeshesByDirPath) live on cityScene and are mirrored into local
  // vars by _syncFromCityScene above. The neon path line, tree-click
  // routing, and selection-restore logic all read those locals.

  // _expectedSidewalkTint(sw) — selected / hover color, or null for the
  // resting tint. Selection wins over hover. (No "path" tint anymore —
  // the gem→selection lineage is shown only by the neon path line.)
  function _expectedSidewalkTint(sw) {
    if (currentSelection && currentSelection.kind === NODE_KIND.DIRECTORY &&
        currentSelection.sidewalk === sw) {
      return SIDEWALK_SELECTED_COLOR;
    }
    if (currentHover && currentHover.kind === NODE_KIND.DIRECTORY &&
        currentHover.sidewalk === sw) {
      return SIDEWALK_HOVER_COLOR;
    }
    return null;
  }

  function _refreshSidewalkTints() {
    for (var ri = 0; ri < streetPickables.length; ri++) {
      var sw = streetPickables[ri];
      if (sw.userData.origColor == null) {
        sw.userData.origColor = sw.material.color.getHex();
      }
      var expected = _expectedSidewalkTint(sw);
      var swColor = expected != null ? expected : sw.userData.origColor;
      sw.material.color.setHex(swColor);
      // Building connector strips for this street follow its tint so the
      // lineage / selection / hover colors extend continuously from the
      // sidewalk into each adjacent building's path.
      var swDir = sw.userData.street && sw.userData.street.dir;
      var connectors = swDir ? pathMeshesByDirPath[swDir.path] : null;
      if (connectors) {
        for (var ci = 0; ci < connectors.length; ci++) {
          var pm = connectors[ci];
          if (pm.userData.origColor == null) {
            pm.userData.origColor = pm.material.color.getHex();
          }
          pm.material.color.setHex(swColor);
        }
      }
    }
  }

  // applyTheme() — hot-apply the current values from src/config/* to every
  // material / cache that's set once at scene-build time. The Settings UI
  // mutates the config stores (SIDEWALK_COLORS, BUILDING_OUTLINE, etc.)
  // and calls this to flush the changes through. Render-loop values
  // (BUILDING_FADE.*, HOVER.COMMIT_MS) are read fresh each frame and
  // don't need anything here.
  function applyTheme() {
    var sidewalk = SIDEWALK_COLORS.get();
    var sceneCol = SCENE_COLORS.get();

    // Sidewalk hex caches + every sidewalk mesh's resting color. We update
    // userData.origColor too so a state-driven recolor (hover/selected)
    // restores to the new default when it lifts.
    SIDEWALK_HOVER_COLOR    = new THREE.Color(sidewalk.HOVER).getHex();
    SIDEWALK_SELECTED_COLOR = new THREE.Color(sidewalk.SELECTED).getHex();
    SIDEWALK_DEFAULT_COLOR  = new THREE.Color(sidewalk.DEFAULT).getHex();
    for (var si = 0; si < streetPickables.length; si++) {
      streetPickables[si].userData.origColor = SIDEWALK_DEFAULT_COLOR;
    }
    _refreshSidewalkTints();

    // Asphalt: each street's inner stripe.
    var asphaltHex = new THREE.Color(ASPHALT.get().COLOR).getHex();
    for (var ai = 0; ai < asphaltMeshes.length; ai++) {
      asphaltMeshes[ai].material.color.setHex(asphaltHex);
    }

    // Scene background (the void behind everything).
    scene.background = new THREE.Color(sceneCol.GROUND);

    // Hover/selected outlines + per-building outlines: outlineRenderer
    // owns those materials.
    outlineRenderer.refreshMaterials();
    // Selection path line + hover preview path line: pathLineRenderer
    // owns those materials and re-evaluates the hover line's visibility
    // (in case HOVER_PATH_LINE.ENABLED just flipped).
    pathLineRenderer.refreshMaterials();

    // Root gem — edge color + body opacity. Body color is per-vertex
    // (palette baked into the geometry) so we don't recolor it here.
    var gemAppearance = GEM_APPEARANCE.get();
    if (rootGemEdges && rootGemEdges.material && rootGemEdges.material.color) {
      rootGemEdges.material.color.set(gemAppearance.EDGE_COLOR);
    }
    if (rootGemBody && rootGemBody.material) {
      rootGemBody.material.opacity = gemAppearance.BODY_OPACITY;
    }

    // Root gem hover-lift. baseY = radius + streetWidth × HOVER_LIFT_FRAC.
    // Both ingredients were stashed on rootGem.userData at scene-build time.
    // Render loop adds the bob offset on top of baseY each frame, so we just
    // update baseY and the next frame picks up the new resting height.
    if (rootGem && rootGem.userData.streetWidth != null) {
      var hoverFrac = GEM_SIZING.get().HOVER_LIFT_FRAC;
      rootGem.userData.baseY = rootGem.userData.radius +
                               rootGem.userData.streetWidth * hoverFrac;
    }

    // Street labels — HEIGHT_FRAC (plane size, scaled relative to the
    // original frac so the texture stays pixel-correct), stashed on each
    // label group's userData. ELEVATION is set once at scene-build time
    // and isn't re-applied per-frame (no UI surface for it).
    var labelCfg = LABEL_TYPOGRAPHY.get();
    for (var li = 0; li < streetLabels.length; li++) {
      var lg = streetLabels[li];
      var origFrac = lg.userData.origHeightFrac;
      if (origFrac && lg.children[0]) {
        var s = labelCfg.HEIGHT_FRAC / origFrac;
        lg.children[0].scale.set(s, s, 1);
      }
    }
  }

  // The neon selection path line, the hover preview path line, and the
  // rainbow chase live in interaction/pathLineRenderer.js. Building-fade
  // tier logic lives in interaction/buildingFader.js. Hover/selected
  // outline meshes + per-building outline + ghost updates live in
  // interaction/outlineRenderer.js. All three subscribe to picker /
  // cityScene directly and run their own per-frame work via update().

  // ---- Selection + hover state (single source of truth) ----
  //
  // Both `currentSelection` and `currentHover` are EITHER null OR an object:
  //   { kind: NODE_KIND.FILE,      mesh, data, file }       — a file building
  //   { kind: NODE_KIND.DIRECTORY, sidewalk, street, dir }  — a directory street
  //
  // All visuals (outlines, sidewalk tints, X-ray fades, sidebar contents,
  // tooltip) derive from these two values. State changes go through
  // `_setSelection()` and `_setHover()`, which atomically clear prior
  // visuals before applying new ones — no stale state, no dangling X-ray
  // focus when the user moves on to something else.
  var currentSelection = null;
  var currentHover     = null;

  canvas.addEventListener('pointerdown', function (e) {
    downX = e.clientX;
    downY = e.clientY;
    downTime = Date.now();
  });

  canvas.addEventListener('pointerup', function (e) {
    if (e.button !== 0) return;
    var dx = e.clientX - downX;
    var dy = e.clientY - downY;
    var dtime = Date.now() - downTime;
    var input  = INPUT_TIMING.get();
    var moveSq = input.CLICK_MOVE_THRESHOLD_PX * input.CLICK_MOVE_THRESHOLD_PX;
    if (dx * dx + dy * dy > moveSq) return;
    if (dtime > input.CLICK_TIME_THRESHOLD_MS) return;
    _handlePick(e.clientX, e.clientY);
  });

  function _handlePick(clientX, clientY) {
    var hit = picker.pickAt(clientX, clientY);
    if (!hit) {
      picker.setSelection(null);
      return;
    }
    // Gem click → reset view + clear selection. The sidebar's
    // visibility is the user's call; we just clear what's shown.
    if (hit.object.userData.type === NODE_KIND.GEM) {
      picker.setSelection(null);
      resetView();
      return;
    }
    var target = picker.interpretHit(hit);
    picker.setSelection(target);
  }

  // _setSelection is now a thin wrapper around picker.setSelection. The
  // side effects (outline updates, sidewalk tints, path lines, header /
  // footer / sidebar refresh) live in _onSelectionChanged below, wired
  // via picker.selection.subscribe. Persistence rides on the picker's
  // selectionKey atom, hooked into localStorage by the boot block.
  function _setSelection(sel) { picker.setSelection(sel); }

  function _onSelectionChanged(sel, _prev) {
    // outlineRenderer + pathLineRenderer subscribe to picker directly;
    // they own the outline visibility and path-line geometry.
    _refreshSidewalkTints();
    _syncTreeSelection(sel);

    // Sitewide header mirrors the selection
    var node = sel && (sel.file || sel.dir);
    appHeader.setSelection(node ? {
      path:      node.path || node.fullPath || node.name || '',
      fullPath:  node.fullPath || '',
      extension: node.extension || '',
      isDir:     sel.kind === NODE_KIND.DIRECTORY,
    } : null);

    // Footer mirrors the selection's metadata. Files: language · lines ·
    // size · modified · created. Directories: file/dir counts + total
    // bytes. Null selection falls back to the project root's totals so
    // the footer is always populated with something useful.
    if (sel && sel.kind === NODE_KIND.FILE) {
      var f = sel.file || {};
      var hasGit = f.git && (f.git.created || f.git.modified);
      appFooter.setSelection({
        kind:       'file',
        language:   humanLanguageFor(f),
        lines:      f.lines,
        size:       f.size || 0,
        modified:   (f.git && f.git.modified) || f.modified || null,
        created:    (f.git && f.git.created)  || f.created  || null,
        dateSource: hasGit ? 'git' : 'fs',
      });
    } else {
      var d = (sel && sel.dir) || manifest.tree || {};
      appFooter.setSelection({
        kind:  'directory',
        files: d.descendants_file_count || 0,
        dirs:  d.descendants_dir_count  || 0,
        size:  d.descendants_size       || 0,
      });
    }

    _renderSidebar();
  }

  // Breadcrumb-segment click → resolve the path to a building or street
  // and route through picker.setSelection so all the usual side-effects fire.
  function _selectByPath(path) { picker.selectByPath(path); }

  // City → tree: mirror the active selection into the left tree pane so
  // the highlighted row always matches what's outlined in the scene.
  // Defined as a no-op until the left sidebar is built (initial scene
  // setup runs before showLeftSidebar; _refreshSidewalkTints can fire
  // _setSelection during that window via the saved-selection restore).
  var _syncTreeSelection = function () {};

  // _setHover(h) — single entry point for hover. Independent of selection
  // (you can hover one thing while selecting another); coordinates via
  // _refreshSidewalkTints() which picks the right per-street tint.
  // Thin wrapper around picker.setHover. Side effects live in
  // _onHoverChanged below, wired via picker.hover.subscribe.
  function _setHover(h) { picker.setHover(h); }

  function _onHoverChanged(h, _prev) {
    // outlineRenderer + pathLineRenderer subscribe to picker.hover
    // directly; they own the hover outline visibility and hover
    // preview path line.
    _refreshSidewalkTints();
    _syncTreeHover(h);
  }

  // Subscribe to picker AFTER all the dependencies _onSelectionChanged /
  // _onHoverChanged need (selectedOutline, hoverOutline, appHeader,
  // appFooter, _renderSidebar, etc.) are in scope. Subscribers fire
  // immediately with the current atom value, which lets a saved
  // selection (resolved by picker on cityScene rebuild) light up the
  // city automatically without a separate restore block.
  picker.selection.subscribe(function (sel) {
    var prev = currentSelection;
    currentSelection = sel;
    _onSelectionChanged(sel, prev);
  });
  picker.hover.subscribe(function (h) {
    var prev = currentHover;
    currentHover = h;
    _onHoverChanged(h, prev);
  });

  // City → tree hover mirror. Same late-binding pattern as
  // _syncTreeSelection: scene init can fire _setHover before the left
  // sidebar has been built, so start as a no-op and replace once the
  // sidebar's api is available.
  var _syncTreeHover = function () {};

  // Double-click + F dispatch by what's under the cursor:
  //   - building → frame the door face head-on
  //   - street   → square the street to screen-horizontal and zoom in for
  //                navigating it
  //   - empty    → ignored (focus only acts on real pickable objects)
  canvas.addEventListener('dblclick', function (e) {
    _focusAtPointer(e.clientX, e.clientY);
  });

  function _focusAtPointer(clientX, clientY) {
    var hit = picker.pickAt(clientX, clientY);
    if (!hit) return;
    var ud = hit.object.userData;
    if (ud.type === NODE_KIND.GEM) {       // dblclick gem also resets view
      resetView();
      return;
    }
    if (ud.building && ud.building.file && ud.building.file.type === NODE_KIND.FILE) {
      _focusOnBuilding(hit.object, ud.building);
      return;
    }
    if (ud.street) {
      _focusOnStreet(ud.street, hit.point);
      return;
    }
    _recenterPivotToPoint(new THREE.Vector3(hit.point.x, 0, hit.point.z));
  }

  // resetView / recenterTo / focusBuilding / focusStreet now live on
  // cameraRig. Aliases so existing call sites read like the originals.
  var resetView              = function ()        { rig.reset(); };
  var _recenterPivotToPoint  = function (p)       { rig.recenterTo(p); };
  var _focusOnBuilding       = function (mesh, b) { rig.focusBuilding(mesh, b); };
  var _focusOnStreet         = function (s, hp)   { rig.focusStreet(s, hp); };

  // Hover pipeline: pointermove fires faster than render frames, so we
  // coalesce events into one raycast per rAF tick. The raycast result
  // then sits in a short commit-delay buffer — only after the cursor
  // hovers a target for HOVER.commit_ms does the heavy cascade fade
  // engage. Brief brushes (mouse sweeping across the scene) never
  // commit, which keeps the city stable instead of strobing tiers.
  // Tooltip + cursor still update on every coalesced raycast for
  // responsiveness — only the fade-cascade is debounced.
  var _hoverRafId      = 0;
  var _hoverLastEvt    = null;
  var _hoverPending    = null;   // candidate hover awaiting commit
  var _hoverCommitId   = 0;      // setTimeout id

  canvas.addEventListener('pointermove', function (e) {
    _hoverLastEvt = e;
    if (_hoverRafId) return;
    _hoverRafId = requestAnimationFrame(_processHoverRaf);
  });

  function _processHoverRaf() {
    _hoverRafId = 0;
    var e = _hoverLastEvt;
    if (!e) return;
    var hit = picker.pickAt(e.clientX, e.clientY);
    var newHover = picker.interpretHit(hit);
    // Filter: directory-shaped targets that came from a building (file
    // tree happens to mark this; we treat as no hover).
    if (newHover && newHover.kind === NODE_KIND.DIRECTORY && !newHover.sidewalk) {
      newHover = null;
    }
    var tooltipText = _tooltipForHover(newHover);

    // Tooltip + cursor: immediate (lightweight, want responsiveness).
    if (tooltipText) {
      showTooltip(tooltipText, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      hideTooltip();
      canvas.style.cursor = 'grab';
    }

    // Hover commit: debounced. If the candidate already matches what's
    // committed (or what's pending), nothing to do. Otherwise restart
    // the timer — only stable hovers (held > HOVER.commit_ms) commit.
    // Empty-space (newHover = null) goes through the same timer so
    // sweeping across a gap between two targets doesn't flicker off.
    if (_sameHover(newHover, currentHover)) {
      // Cursor returned to the already-committed target — drop any
      // pending change so we don't rebound to a stale candidate.
      if (_hoverCommitId) { clearTimeout(_hoverCommitId); _hoverCommitId = 0; }
      _hoverPending = null;
      return;
    }
    // Already-queued check: gate on _hoverCommitId being live, since
    // _hoverPending is null both when idle AND when "pending null is
    // about to commit." Without the gate, currentHover=building +
    // newHover=null + idle pending matches as "already queued" and
    // hover gets stuck on the building.
    if (_hoverCommitId && _sameHover(newHover, _hoverPending)) return;
    _hoverPending = newHover;
    if (_hoverCommitId) clearTimeout(_hoverCommitId);
    _hoverCommitId = setTimeout(function () {
      _hoverCommitId = 0;
      var toCommit = _hoverPending;
      _hoverPending = null;
      if (!_sameHover(toCommit, currentHover)) _setHover(toCommit);
    }, INPUT_TIMING.get().HOVER_COMMIT_MS);
  }

  function _tooltipForHover(target) {
    if (!target) return null;
    if (target.kind === NODE_KIND.GEM) {
      var rs = cityScene.getRootStreet();
      var rootName = (rs && rs.dir && rs.dir.name) || 'root';
      return 'root  ·  ' + rootName;
    }
    if (target.kind === NODE_KIND.FILE && target.file) {
      var f = target.file;
      var fpath = f.path || f.name || 'file';
      return fpath + (f.lines != null ? '  ·  ' + f.lines + ' lines' : '');
    }
    if (target.kind === NODE_KIND.DIRECTORY && target.dir) {
      var d = target.dir;
      var dpath = d.path || d.name || 'directory';
      var fileCount = (d.descendants_file_count != null) ? d.descendants_file_count : 0;
      var dirCount  = (d.descendants_dir_count  != null) ? d.descendants_dir_count  : 0;
      var counts = fileCount + ' file' + (fileCount === 1 ? '' : 's') +
                   ', '      + dirCount  + ' dir'  + (dirCount  === 1 ? '' : 's');
      return dpath + '  ·  ' + counts;
    }
    return null;
  }

  function _sameHover(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === NODE_KIND.FILE)      return a.mesh === b.mesh;
    if (a.kind === NODE_KIND.DIRECTORY) return a.sidewalk === b.sidewalk;
    if (a.kind === NODE_KIND.GEM)       return true;     // singleton
    return false;
  }

  // Hide tooltip + clear hover when the cursor leaves the canvas (drifts
  // onto sidebar, leaves window). Selection is left alone — only hover.
  canvas.addEventListener('pointerleave', function () {
    hideTooltip();
    // Cancel any pending raycast / commit so a stale candidate doesn't
    // sneak through after the cursor leaves the canvas.
    if (_hoverRafId)    { cancelAnimationFrame(_hoverRafId); _hoverRafId = 0; }
    if (_hoverCommitId) { clearTimeout(_hoverCommitId);      _hoverCommitId = 0; }
    _hoverPending = null;
    _setHover(null);
  });

  // -- 7. Resize ---------------------------------------------------------------
  function onResize() {
    _resizeRendererToCanvas(renderer, canvas);
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    camera.aspect = cw / Math.max(1, ch);
    camera.updateProjectionMatrix();
    // LineMaterial.resolution updates live in each renderer module.
    outlineRenderer.onResize();
    pathLineRenderer.onResize();
    // Paint the resized canvas synchronously so the browser doesn't show
    // a blank/cleared frame between the resize and the next animate() tick.
    renderer.render(scene, camera);
  }
  window.addEventListener('resize', onResize);
  // Sidebars now share horizontal space with the canvas via flexbox (3-pane
  // layout), so opening, closing, or dragging either sidebar changes the
  // canvas size without firing a window resize event. ResizeObserver fills
  // that gap — it fires whenever the canvas's box dimensions change.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onResize).observe(canvas);
  }

  document.addEventListener('keydown', function (e) {
    // Don't intercept hotkeys while the user is typing in an input/textarea
    // (none today, but defensive against future controls-panel additions).
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

    if (e.key === 'Escape') {
      // Esc clears the selection (and any hover) but leaves sidebar
      // visibility alone — if the user has it toggled open via the
      // header, it stays open and re-renders to the empty state.
      _setSelection(null);
      _setHover(null);
    } else if (e.key === 'r' || e.key === 'R' || e.key === 'Home') {
      resetView();
    } else if (e.key === 'f' || e.key === 'F') {
      // Focus on whatever is currently selected. Mirrors the dblclick
      // dispatch (file → building head-on, directory → top-down street),
      // so users don't have to re-aim and double-click after a click-select.
      if (!currentSelection) return;
      if (currentSelection.kind === NODE_KIND.FILE) {
        _focusOnBuilding(currentSelection.mesh, currentSelection.data);
      } else if (currentSelection.kind === NODE_KIND.DIRECTORY) {
        _focusOnStreet(currentSelection.street);
      }
    }
  });

  // Tree → city: a click on a tree row routes through the SAME _setSelection
  // / showFileSidebar / showDirSidebar entry points the canvas pick handler
  // uses, so visual state (outlines, sidewalk tints, neon path line, persisted
  // selection) stays consistent regardless of which surface drove the click.
  // Double-click delegates to _focusOnBuilding / _focusOnStreet — same as
  // the canvas dblclick handler.
  function _onTreeSelect(node) {
    if (!node) return;
    if (node.type === NODE_KIND.FILE) {
      var b = buildingsByPath[node.path];
      if (!b) return;
      _setSelection({
        kind: NODE_KIND.FILE,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file
      });
    } else if (node.type === NODE_KIND.DIRECTORY) {
      var sw = sidewalksByDirPath[node.path];
      var st = streetsByDirPath[node.path];
      if (!sw || !st || !st.dir) return;
      _setSelection({
        kind:     NODE_KIND.DIRECTORY,
        sidewalk: sw,
        street:   st,
        dir:      st.dir
      });
    }
  }
  function _onTreeFocus(node) {
    if (!node) return;
    if (node.type === NODE_KIND.FILE) {
      var b = buildingsByPath[node.path];
      if (b) _focusOnBuilding(b.mesh, b.building);
    } else if (node.type === NODE_KIND.DIRECTORY) {
      var st = streetsByDirPath[node.path];
      if (st) _focusOnStreet(st);
    }
  }
  // Tree hover routes through _setHover so the SAME cascade fade /
  // outline / sidewalk-tint pipeline that responds to canvas hover also
  // responds to tree hover. No debounce: tree hover is a deliberate UI
  // gesture, not a noisy pointermove stream.
  function _onTreeHover(node) {
    if (!node) return;
    if (node.type === NODE_KIND.FILE) {
      var b = buildingsByPath[node.path];
      if (!b) return;
      _setHover({
        kind: NODE_KIND.FILE,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file
      });
    } else if (node.type === NODE_KIND.DIRECTORY) {
      var sw = sidewalksByDirPath[node.path];
      var st = streetsByDirPath[node.path];
      if (!sw || !st || !st.dir) return;
      _setHover({
        kind:     NODE_KIND.DIRECTORY,
        sidewalk: sw,
        street:   st,
        dir:      st.dir
      });
    }
  }
  function _onTreeHoverEnd() {
    _setHover(null);
  }

  var leftSidebarApi = showLeftSidebar(manifest, {
    onResetView:    resetView,
    applyTheme:     applyTheme,
    onTreeSelect:   _onTreeSelect,
    onTreeFocus:    _onTreeFocus,
    onTreeHover:    _onTreeHover,
    onTreeHoverEnd: _onTreeHoverEnd
  });
  _syncTreeSelection = function (sel) {
    if (!leftSidebarApi || !leftSidebarApi.setSelectedTreePath) return;
    if (!sel)                                  leftSidebarApi.setSelectedTreePath(null);
    else if (sel.kind === NODE_KIND.FILE)      leftSidebarApi.setSelectedTreePath(sel.file && sel.file.path);
    else if (sel.kind === NODE_KIND.DIRECTORY) leftSidebarApi.setSelectedTreePath(sel.dir  && sel.dir.path);
  };
  _syncTreeHover = function (h) {
    if (!leftSidebarApi || !leftSidebarApi.setHoveredTreePath) return;
    if (!h)                                  leftSidebarApi.setHoveredTreePath(null);
    else if (h.kind === NODE_KIND.FILE)      leftSidebarApi.setHoveredTreePath(h.file && h.file.path);
    else if (h.kind === NODE_KIND.DIRECTORY) leftSidebarApi.setHoveredTreePath(h.dir  && h.dir.path);
  };
  // Sync the (possibly already-restored) selection / hover into the
  // freshly-built tree pane. picker resolves persisted selection on
  // every cityScene rebuild via its own subscription, so no separate
  // restore block is needed here.
  _syncTreeSelection(currentSelection);
  _syncTreeHover(currentHover);

  // -- 8. Render loop --------------------------------------------------------
  var startTime = performance.now();
  var labelRight = new THREE.Vector3();

  // _updateXRayAndOutlines() — runs every frame. Two jobs:
  function animate() {
    rig.update(0);                     // first-call: bbox-frames camera
    // Per-frame world-matrix refresh. controls.update() moves the camera
    // but matrixWorldInverse is stale until renderer.render runs; modules
    // below project mesh positions and need fresh world matrices.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    fader.update(0);                   // body opacity per fade tier
    outlineRenderer.update(0);         // outline + ghost opacity, hover/selected outlines, rainbow chase
    pathLineRenderer.update(0);        // selection path line rainbow chase
    _orientLabelsForCamera(streetLabels, camera, labelRight);
    if (rootGem) {
      var gemAnim = GEM_ANIMATION.get();
      var t = (performance.now() - startTime) / 1000;
      rootGem.rotation.y = t * gemAnim.ROTATION_SPEED;
      rootGem.position.y = rootGem.userData.baseY + Math.sin(t * gemAnim.BOB_FREQUENCY) * rootGem.userData.bobAmp;
      // Scale-up affordance on hover so the gem reads as clickable.
      var gemTargetScale = (currentHover && currentHover.kind === NODE_KIND.GEM) ? gemAnim.HOVER_SCALE : 1.0;
      var curS = rootGem.scale.x;
      var nextS = curS + (gemTargetScale - curS) * gemAnim.SCALE_LERP_SPEED;
      rootGem.scale.set(nextS, nextS, nextS);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}


// Keep flat street labels readable at any orbit. Flip decision comes from the
// camera's world-right vector (matrixWorld column 0), not position — at top-down
// the camera can sit over center yet still be rotated 180° around Y.
function _orientLabelsForCamera(labels, camera, labelRight) {
  labelRight.setFromMatrixColumn(camera.matrixWorld, 0);
  var rightX = labelRight.x;
  var rightZ = labelRight.z;

  // Hysteresis: only flip when the relevant axis crosses ±THRESH, not 0.
  // Without this, near-top-down camera positions (where rightX/rightZ are
  // near zero) cause floating-point jitter from OrbitControls' damping to
  // flip labels back and forth every frame.
  var THRESH = LABEL_TYPOGRAPHY.get().FLIP_HYSTERESIS;

  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i];
    var street = lbl.userData.street;
    var base = lbl.userData.baseRotY || 0;
    var axis  = (street.orientation === STREET_AXIS.X) ? rightX : rightZ;
    var flipped = lbl.userData.flipped || false;
    if (flipped) {
      // Currently flipped — only un-flip when axis clearly crosses POSITIVE.
      if (axis > THRESH) flipped = false;
    } else {
      // Not flipped — only flip when axis clearly crosses NEGATIVE.
      if (axis < -THRESH) flipped = true;
    }
    lbl.userData.flipped = flipped;
    lbl.rotation.y = base + (flipped ? Math.PI : 0);
  }
}


function _resizeRendererToCanvas(renderer, canvas) {
  var cw = canvas.clientWidth;
  var ch = canvas.clientHeight;
  renderer.setSize(cw, ch, false);
}


// Build the /api/manifest URL from the current page's query params.
// CLI opens the page with either ?path=… or ?clone=…&branch=… so the
// server knows what to scan; we just forward those through.
function manifestUrl() {
  var qp = new URLSearchParams(window.location.search);
  var u = new URL('/api/manifest', window.location.origin);
  if (qp.has('clone')) {
    u.searchParams.set('clone', qp.get('clone'));
    if (qp.has('branch')) u.searchParams.set('branch', qp.get('branch'));
  } else if (qp.has('path')) {
    u.searchParams.set('path', qp.get('path'));
  }
  return u.toString();
}


// Live-update poll loop. When LIVE_UPDATES.ENABLED flips on we start
// re-fetching the manifest at the user-configured interval; when its
// signature changes vs. the last render, we reload the page so the
// scene rebuilds against the new state. A full reload is correct and
// simple — camera/selection aren't persisted across CLI runs anyway,
// so this stays consistent with that behavior.
function _clampPollSeconds(s) {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

function setupLiveUpdates(initialSignature) {
  var lastSignature = initialSignature || '';
  var timer = null;
  var inFlight = false;

  function tick() {
    if (inFlight) return;
    inFlight = true;
    fetch(manifestUrl())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (m && m.signature && m.signature !== lastSignature) {
          // Reload — boot will rerender against the fresh manifest.
          window.location.reload();
        }
      })
      .catch(function () { /* keep polling on transient errors */ })
      .finally(function () { inFlight = false; });
  }

  function start() {
    stop();
    var seconds = _clampPollSeconds(LIVE_UPDATES.get().POLL_SECONDS);
    timer = window.setInterval(tick, seconds * 1000);
  }
  function stop() {
    if (timer != null) { window.clearInterval(timer); timer = null; }
  }

  LIVE_UPDATES.subscribe(function (val) {
    if (val.ENABLED) start(); else stop();
  });
}


// Boot. Guarded by a canvas check so unit tests can import this module
// without triggering any DOM/network side effects.
var _canvas = document.getElementById(DOM_IDS.CANVAS);
if (_canvas) {
  (async function boot() {
    var resp = await fetch(manifestUrl());
    if (!resp.ok) throw new Error('manifest fetch failed: ' + resp.status);
    var manifest = await resp.json();
    // Hydrate every config store from localStorage BEFORE scene build so
    // any user tweaks from prior sessions take effect during the initial
    // layout/render.
    attachPersistence(Config);
    // Picker's selectionKey atom isn't part of the Config barrel, so
    // wire its persistence directly. Hydrating BEFORE startRenderLoop
    // lets the picker's first key→selection resolve see the saved key.
    persistStore('PICKER_SELECTION_KEY', PICKER_SELECTION_KEY);
    startRenderLoop(_canvas, manifest);
    setupLiveUpdates(manifest.signature);
  })();
}

// main.js — Entry point. Reads MANIFEST embedded in index.html, pulls
// shipping defaults from src/defaults.js, lays out the city, builds the
// scene, and starts the render loop with orbit/pan/zoom controls and
// raycast picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 }      from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }       from 'three/addons/lines/LineMaterial.js';
import { listenKeys } from 'nanostores';
import './styles.css';


// 12 edges of a unit cube as flat [x,y,z, x,y,z, ...] segment endpoints.
// Used by the Line2 outlines, which render as triangle strips so the
// linewidth can be set in pixels (regular LineBasicMaterial is locked to
// 1px in WebGL).
var UNIT_BOX_EDGE_POSITIONS = [
  -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,
   0.5,-0.5,-0.5,  0.5,-0.5, 0.5,
   0.5,-0.5, 0.5, -0.5,-0.5, 0.5,
  -0.5,-0.5, 0.5, -0.5,-0.5,-0.5,
  -0.5, 0.5,-0.5,  0.5, 0.5,-0.5,
   0.5, 0.5,-0.5,  0.5, 0.5, 0.5,
   0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5, -0.5, 0.5,-0.5,
  -0.5,-0.5,-0.5, -0.5, 0.5,-0.5,
   0.5,-0.5,-0.5,  0.5, 0.5,-0.5,
   0.5,-0.5, 0.5,  0.5, 0.5, 0.5,
  -0.5,-0.5, 0.5, -0.5, 0.5, 0.5
];

import * as Config from './config/index.js';
import {
  BUILDING_PALETTE,
  SCENE_COLORS,
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  BUILDING_OUTLINE,
  BUILDING_FADE,
  GEM_ANIMATION,
  GEM_APPEARANCE,
  GEM_SIZING,
  CAMERA_PERSPECTIVE,
  CAMERA_CONTROLS,
  CAMERA_ANIMATION,
  INPUT_TIMING,
  PATH_LINE,
  RAINBOW
} from './config/index.js';
import { attachPersistence } from './config/_persist.js';
import { NODE_KIND, DOM_IDS, STREET_AXIS, BUILDING_ORIENT, RENDER_ORDERS } from './constants.js';

// ─── Sightline-search internals (algorithm tuning, not designer dials) ────
// _focusOnBuilding tries head-on, then tilts up if the view is obstructed.
var SIGHTLINE_STEP_DEG     = 20;     // elevation step between attempts
var SIGHTLINE_MAX_ATTEMPTS = 5;      // give up after this many tilts
var SIGHTLINE_FAR_OFFSET   = 0.5;    // shrink raycast.far so it doesn't self-hit

// material.opacity ≥ this counts as fully opaque (depthWrite on, full alpha).
// Just below 1.0 so any faded tier flips to true transparency. Internal
// implementation detail — flipping mat.transparent triggers a shader
// recompile, so we delay the flip until we're truly under 1.0.
var OPAQUE_THRESHOLD = 0.999;

// _stepOpacity(cur, target, cfg) — one-frame lerp toward target with a
// snap-to-target threshold so we don't keep reassigning materials forever
// once we're effectively at the goal.
function _stepOpacity(cur, target, cfg) {
  if (cur === target) return cur;
  var next = cur + (target - cur) * cfg.LERP_SPEED;
  if (Math.abs(next - target) < cfg.SNAP_THRESHOLD) next = target;
  return next;
}
import { buildCityScene, regenerateLabelTexture } from './scene/engine.js';
import { layoutCity } from './scene/layout.js';
import { getBuildingColor, getDateRanges } from './scene/colors.js';
import { showFileSidebar, showDirSidebar, closeSidebar, setSidebarPalette, setSidebarCloseHandler } from './components/sidebar.js';
import { showLeftSidebar } from './components/leftSidebar.js';
import { showTooltip, hideTooltip } from './components/tooltip.js';
import {
  parentDirPath,
  computePathPoints
} from './scene/path.js';


function startRenderLoop(canvas, manifest) {
  // Every visual / layout tunable comes from the named exports of
  // src/defaults.js. Render-loop code reads them fresh each frame (or
  // each event), so the Settings UI can mutate the imported objects in
  // place and changes take effect immediately. Material-level
  // applications (line widths, hex color caches, scene background) are
  // re-synced via applyTheme() — exposed to the Settings UI through
  // showLeftSidebar().

  // -- 1. Layout + colors ------------------------------------------------------
  var layout     = layoutCity(manifest.tree);
  var dateRanges = getDateRanges(manifest.tree);
  setSidebarPalette(BUILDING_PALETTE.get().HUE_EXT_MAP || {});

  for (var i = 0; i < layout.buildings.length; i++) {
    var b = layout.buildings[i];
    if (b.file && b.file.type === NODE_KIND.FILE) {
      b.color = getBuildingColor(b.file, dateRanges);
    } else {
      b.color = BUILDING_PALETTE.get().DIRECTORY_COLOR;
    }
  }

  // -- 2. Scene ----------------------------------------------------------------
  var built = buildCityScene(layout);
  var scene = built.scene;
  var buildingMeshes  = built.buildingMeshes;
  var streetPickables = built.streetPickables;
  var streetLabels    = built.streetLabels;
  // Hot-reload the label fill color: FILL is baked into the CanvasTexture
  // at scene-build, so a "live" change requires regenerating each label's
  // texture. listenKeys fires only when FILL specifically changes (not on
  // every applyTheme call), so unrelated tweaks don't pay the texture
  // regen cost. Other label-typography keys (font size, padding, stroke
  // width) change canvas dimensions too — those stay rebuild-required.
  listenKeys(LABEL_TYPOGRAPHY, ['FILL'], function () {
    for (var li = 0; li < streetLabels.length; li++) {
      regenerateLabelTexture(streetLabels[li]);
    }
  });
  var pathMeshes      = built.pathMeshes || [];
  var asphaltMeshes   = built.asphaltMeshes || [];
  var rootGem         = built.rootGem;
  var rootGemBody     = built.rootGemBody  || null;
  var rootGemEdges    = built.rootGemEdges || null;
  // pickables is rebuilt on every height-mode toggle (since building meshes
  // are disposed + replaced), so we wrap the array in a getter-style closure
  // and pass `getPickables()` to the raycaster.
  var pickables = buildingMeshes.concat(streetPickables);
  // Gem is also clickable — click acts as a "reset view to start" gesture
  // (city's signature landmark doubles as a home button).
  if (rootGem) {
    var gemBody = rootGem.children && rootGem.children[0];
    if (gemBody) {
      gemBody.userData.type = NODE_KIND.GEM;
      pickables.push(gemBody);
    }
  }
  function getPickables() { return pickables; }
  var bbox = built.bbox;

  // Per-building wireframe outlines + solid-color "ghost" bodies. Both are
  // always in the scene; visibility/opacity is driven by the per-frame fade.
  //
  //   outline: visible inversely to building opacity → silhouette stays
  //            readable when the building fades out. Uses LineSegments2 +
  //            LineMaterial so linewidth is settable in pixels (Three.js's
  //            LineBasicMaterial is locked to 1px hairline in WebGL).
  //   ghost:   used INSTEAD of the textured mesh below a fade threshold,
  //            to remove window noise on heavily-faded buildings (Cities-
  //            Skylines-style "data view" — silhouette + color, no detail).
  var _unitBoxGeo   = new THREE.BoxGeometry(1, 1, 1);
  var buildingOutlines      = [];   // parallel to buildingMeshes
  var buildingOutlineMats   = [];   // each LineMaterial needs resolution updates on resize
  var buildingGhosts        = [];
  for (var bli = 0; bli < buildingMeshes.length; bli++) {
    var _bm = buildingMeshes[bli];
    var _bd = _bm.userData.building;
    var _bcol = new THREE.Color(_bd.color);

    var _olGeo = new LineSegmentsGeometry();
    _olGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
    var _olMat = new LineMaterial({
      color:       _bcol.clone(),
      linewidth:   BUILDING_OUTLINE.get().WIDTH,
      transparent: true,
      opacity:     0.0,
      depthTest:   true,
      depthWrite:  false,
      worldUnits:  false
    });
    _olMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
    var _ol = new LineSegments2(_olGeo, _olMat);
    _ol.renderOrder = 5;
    _ol.scale.set(_bd.w, _bd.h * (_bm.scale.y || 1), _bd.d);
    _ol.position.copy(_bm.position);
    scene.add(_ol);
    buildingOutlines.push(_ol);
    buildingOutlineMats.push(_olMat);

    var _gh = new THREE.Mesh(
      _unitBoxGeo,
      new THREE.MeshBasicMaterial({
        color:       _bcol.clone(),
        transparent: true,
        opacity:     0.0,
        depthWrite:  false
      })
    );
    _gh.visible = false;
    _gh.scale.set(_bd.w, _bd.h * (_bm.scale.y || 1), _bd.d);
    _gh.position.copy(_bm.position);
    scene.add(_gh);
    buildingGhosts.push(_gh);
  }

  // -- 3. Renderer -------------------------------------------------------------
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  _resizeRendererToCanvas(renderer, canvas);

  // -- 4. Camera ---------------------------------------------------------------
  var W = canvas.clientWidth;
  var H = canvas.clientHeight;
  var perspective = CAMERA_PERSPECTIVE.get();
  var cameraControlsCfg = CAMERA_CONTROLS.get();
  var camera = new THREE.PerspectiveCamera(
    perspective.FOV,
    W / Math.max(1, H),
    perspective.NEAR,
    perspective.FAR
  );

  // Isometric framing from the -X/+Y/+Z octant. Orbit pivot sits ON THE
  // GROUND at the center of the ROOT STREET (the main road) — anchored to
  // the city's spine, not the bbox center, so subdirectory branches don't
  // pull the pivot off-axis.
  var center = new THREE.Vector3();
  bbox.getCenter(center);

  var rootStreet = (layout.streets || []).filter(function (s) { return s.isRoot; })[0];
  var groundCenter = rootStreet
    ? new THREE.Vector3(rootStreet.x, 0, rootStreet.y)
    : new THREE.Vector3(center.x, 0, center.z);

  // Gem world position (origin end of the root street). Used by street
  // focus to orient the camera so the gem reliably sits at the top of the
  // frame — gives the user a fixed landmark for spatial orientation no
  // matter which street they jump to.
  var gemWorldPos = null;
  if (rootStreet) {
    gemWorldPos = new THREE.Vector3();
    if (rootStreet.orientation === STREET_AXIS.X) {
      gemWorldPos.set(
        rootStreet.x - rootStreet.length / 2 + rootStreet.width / 2,
        0,
        rootStreet.y
      );
    } else {
      gemWorldPos.set(
        rootStreet.x,
        0,
        rootStreet.y - rootStreet.length / 2 + rootStreet.width / 2
      );
    }
  }

  // Camera distance: framed from the orbit pivot, sized to the FARTHEST bbox
  // corner relative to the pivot — guarantees every building fits even when
  // the pivot is offset from bbox center. INITIAL_DISTANCE_MULT shrinks the
  // fitted distance to give the city tight, comfortable framing.
  var farX = Math.max(Math.abs(bbox.max.x - groundCenter.x), Math.abs(bbox.min.x - groundCenter.x));
  var farY = Math.max(Math.abs(bbox.max.y - groundCenter.y), Math.abs(bbox.min.y - groundCenter.y));
  var farZ = Math.max(Math.abs(bbox.max.z - groundCenter.z), Math.abs(bbox.min.z - groundCenter.z));
  var radius = Math.sqrt(farX * farX + farY * farY + farZ * farZ);
  var dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * cameraControlsCfg.INITIAL_DISTANCE_MULT;

  var dir = new THREE.Vector3(-1, 1, 1).normalize();
  camera.position.copy(groundCenter).add(dir.multiplyScalar(dist));
  camera.lookAt(groundCenter);

  // -- 5. Controls -------------------------------------------------------------
  var controls = new OrbitControls(camera, canvas);
  controls.target.copy(groundCenter);
  controls.enableDamping = true;
  controls.dampingFactor = cameraControlsCfg.DAMPING_FACTOR;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = Math.PI * cameraControlsCfg.MAX_POLAR_ANGLE_FRAC;
  controls.minDistance = cameraControlsCfg.MIN_DISTANCE;
  controls.maxDistance = dist * cameraControlsCfg.MAX_DISTANCE_MULT;
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.PAN
  };

  // Snapshot the true default pose BEFORE the persistence block can
  // overwrite camera.position / controls.target with a saved pose.
  // resetView() animates back to these values, so they must reflect
  // the freshly-fitted defaults, not whatever the user last navigated to.
  var initialCamPos = camera.position.clone();
  var initialTarget = controls.target.clone();

  // ---- Camera pose persistence ----
  // Snapshot camera + orbit target to localStorage when the user stops
  // changing them, so reload picks up where they left off. Uses a
  // 500ms debounce off OrbitControls' 'change' event — fires for both
  // user drags AND programmatic animations (resetView, focus-on-X), since
  // both end up calling controls.update() and detecting position changes.
  var SAVED_CAMERA_KEY = 'cc.cameraPose';
  var _saveCameraTimer = 0;
  function _saveCameraPose() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SAVED_CAMERA_KEY, JSON.stringify({
        pos:    { x: camera.position.x,  y: camera.position.y,  z: camera.position.z  },
        target: { x: controls.target.x,  y: controls.target.y,  z: controls.target.z  }
      }));
    } catch (_) { /* private mode / quota — drop silently */ }
  }
  function _scheduleCameraSave() {
    if (_saveCameraTimer) clearTimeout(_saveCameraTimer);
    _saveCameraTimer = setTimeout(function () {
      _saveCameraTimer = 0;
      _saveCameraPose();
    }, 500);
  }

  // Restore saved camera pose on boot, BEFORE attaching the change listener
  // so the load itself doesn't immediately re-trigger a save.
  try {
    if (typeof localStorage !== 'undefined') {
      var savedPoseRaw = localStorage.getItem(SAVED_CAMERA_KEY);
      if (savedPoseRaw) {
        var p = JSON.parse(savedPoseRaw);
        if (p && p.pos && p.target) {
          camera.position.set(p.pos.x, p.pos.y, p.pos.z);
          controls.target.set(p.target.x, p.target.y, p.target.z);
        }
      }
    }
  } catch (_) { /* corrupt JSON / unavailable storage — stay at default */ }

  controls.addEventListener('change', _scheduleCameraSave);

  // -- 6. Raycaster picking ----------------------------------------------------
  var raycaster = new THREE.Raycaster();
  var pointer   = new THREE.Vector2();

  // Click vs. drag: track pointerdown→pointerup with a movement + time threshold.
  var downX = 0, downY = 0, downTime = 0;

  var camAnimToken = 0;

  var _orders = RENDER_ORDERS;

  // Hover + selection outlines for buildings: ONE shared mesh per state,
  // retransformed to whichever building is currently hovered / selected.
  // LineSegments2 (vs the regular LineSegments) renders as triangle strips
  // so linewidth can actually be set in pixels — regular WebGL lines are
  // locked to 1px, which reads as a faint hairline. ~3px feels much more
  // like a Cities-Skylines selection outline.
  var _unitEdgesGeo = new LineSegmentsGeometry();
  _unitEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);

  var _bo = BUILDING_OUTLINE.get();
  var hoverLineMat = new LineMaterial({
    color:      new THREE.Color(_bo.HOVER_COLOR),
    linewidth:  _bo.WIDTH,
    transparent: true,
    opacity:    _bo.HOVER_OPACITY,
    depthTest:  true,
    worldUnits: false
  });
  hoverLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  var hoverOutline = new LineSegments2(_unitEdgesGeo, hoverLineMat);
  hoverOutline.visible = false;
  hoverOutline.renderOrder = _orders.HOVER_OUTLINE;
  scene.add(hoverOutline);

  // Selected: Line2 outline with per-segment vertex colors so the 12 box
  // edges show different hues that ROTATE around the wheel each frame —
  // a chasing-rainbow neon effect. Each segment's start and end share one
  // hue (so the segment is solid-colored), but neighboring segments are
  // offset by 1/12 of the wheel.
  var selectedLineMat = new LineMaterial({
    vertexColors: true,
    linewidth:    _bo.WIDTH,
    transparent:  true,
    opacity:      _bo.SELECTED_OPACITY,
    depthTest:    true,
    worldUnits:   false
  });
  selectedLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);

  // Each outline needs its OWN geometry instance because instance colors
  // are stored on the geometry, not the material. Hover keeps the shared
  // geometry; selected gets its own with the color buffer attached.
  var _selectedEdgesGeo = new LineSegmentsGeometry();
  _selectedEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  var _selectedColors = new Float32Array(12 * 6);   // 12 segments × (startRGB + endRGB)
  for (var ci = 0; ci < _selectedColors.length; ci++) _selectedColors[ci] = 1;
  _selectedEdgesGeo.setColors(_selectedColors);
  var _selColorBuf = _selectedEdgesGeo.attributes.instanceColorStart.data;
  var _tmpHsl      = new THREE.Color();

  var selectedOutline = new LineSegments2(_selectedEdgesGeo, selectedLineMat);
  selectedOutline.visible = false;
  selectedOutline.renderOrder = _orders.SELECTED_OUTLINE;
  scene.add(selectedOutline);

  // _dirTreeDistance(file, dir) — tree distance from `file`'s parent
  // directory to `dir`, measured as edges in the directory tree (LCA
  // distance). Drives the hover/selected fade tiers:
  //   0  → file lives directly in dir (the "neighborhood")
  //   1  → file lives one level up (dir's parent's other files —
  //         direct ancestor) OR one level down (dir's direct subdir's
  //         files — direct descendant). Always lies on dir's spine.
  //   ≥2 → off-spine: cousins (1 up + 1 down), grandparent's files,
  //         deeper descendants, etc. Gets the outline-only treatment.
  // Returns Infinity if either input is missing.
  function _dirTreeDistance(file, dir) {
    if (!file || !file.path || !dir || dir.path == null) return Infinity;
    var parent = parentDirPath(file.path);
    if (parent == null) parent = '.';
    if (parent === dir.path) return 0;
    var ap = (parent === '.' || parent === '') ? [] : parent.split('/');
    var dp = (dir.path === '.' || dir.path === '') ? [] : dir.path.split('/');
    var lca = 0;
    while (lca < ap.length && lca < dp.length && ap[lca] === dp[lca]) lca++;
    return (ap.length - lca) + (dp.length - lca);
  }

  // _setSegHueGradient(segIdx, hueStart, hueEnd) — write a HSL gradient into
  // segment segIdx's start+end colors. Wraps hue values via mod 1. Caller
  // is responsible for copying _selectedColors → _selColorBuf.array once
  // after all segments are written, and flagging needsUpdate.
  function _setSegHueGradient(segIdx, hueStart, hueEnd) {
    var rb = RAINBOW.get();
    var k = segIdx * 6;
    _tmpHsl.setHSL(((hueStart % 1) + 1) % 1, rb.SATURATION, rb.LIGHTNESS);
    _selectedColors[k]     = _tmpHsl.r;
    _selectedColors[k + 1] = _tmpHsl.g;
    _selectedColors[k + 2] = _tmpHsl.b;
    _tmpHsl.setHSL(((hueEnd   % 1) + 1) % 1, rb.SATURATION, rb.LIGHTNESS);
    _selectedColors[k + 3] = _tmpHsl.r;
    _selectedColors[k + 4] = _tmpHsl.g;
    _selectedColors[k + 5] = _tmpHsl.b;
  }


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

  // Lookup: directory path → sidewalk mesh / street object. Used to walk
  // the parent chain from a selected dir/file back to root, which lets us
  // draw the neon path line through the road network.
  var sidewalksByDirPath = {};
  var streetsByDirPath   = {};
  for (var spi = 0; spi < streetPickables.length; spi++) {
    var _sw = streetPickables[spi];
    var _swStreet = _sw.userData.street;
    var _swDir    = _swStreet && _swStreet.dir;
    if (_swDir && _swDir.path != null) {
      sidewalksByDirPath[_swDir.path] = _sw;
      streetsByDirPath[_swDir.path]   = _swStreet;
    }
  }

  // Building-to-street connector strips, grouped by parent dir path so
  // they can be tinted alongside their street's sidewalk (selected /
  // hover colors).
  var pathMeshesByDirPath = {};
  for (var pmi = 0; pmi < pathMeshes.length; pmi++) {
    var _pm = pathMeshes[pmi];
    var _pmFile = _pm.userData.file;
    var _pmDir  = _pmFile && _pmFile.path != null ? parentDirPath(_pmFile.path) : null;
    if (_pmDir == null) continue;
    if (!pathMeshesByDirPath[_pmDir]) pathMeshesByDirPath[_pmDir] = [];
    pathMeshesByDirPath[_pmDir].push(_pm);
  }

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
    var outline  = BUILDING_OUTLINE.get();

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

    // Hover + selected outline overlays.
    hoverLineMat.color.set(outline.HOVER_COLOR);
    hoverLineMat.linewidth    = outline.WIDTH;
    hoverLineMat.opacity      = outline.HOVER_OPACITY;
    selectedLineMat.linewidth = outline.WIDTH;
    selectedLineMat.opacity   = outline.SELECTED_OPACITY;
    // Per-building default outlines (the colored wireframes that fade in
    // as the building dims out).
    for (var oi = 0; oi < buildingOutlineMats.length; oi++) {
      buildingOutlineMats[oi].linewidth = outline.WIDTH;
    }
    // Selection path line linewidth + opacity. Both must be applied here so
    // tweaks land immediately even when no selection change is happening
    // (without this, opacity only refreshed inside _updatePathLine which
    // fires on selection change). When no path is visible, _updatePathLine
    // already sets opacity to 0 — guard so we don't override that.
    var plCfg = PATH_LINE.get();
    pathLineMat.linewidth = plCfg.LINEWIDTH;
    if (pathLine.visible) pathLineMat.opacity = plCfg.OPACITY;

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

  // ---- Neon path line: gem → ... → selection ----
  // Built from independent line segments (LineSegments2) — one segment
  // per leg of the path. Tried Line2 (polyline) first but its mitered
  // bends silently dropped subsequent legs in dynamic updates; segments
  // are more robust. Per-segment vertex colors cycle through the rainbow
  // each frame for the same chasing-neon effect as the building outline.
  var _pl = PATH_LINE.get();
  var pathLineMat = new LineMaterial({
    vertexColors: true,
    linewidth:    _pl.LINEWIDTH,
    transparent:  true,
    opacity:      0.0,
    depthTest:    true,            // buildings occlude the line
    depthWrite:   false,           // don't pollute depth for later passes
    worldUnits:   false
  });
  pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  var pathLineGeo = new LineSegmentsGeometry();
  pathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);   // placeholder
  var pathLine = new LineSegments2(pathLineGeo, pathLineMat);
  pathLine.visible = false;
  // Render BEFORE labels so labels' alpha-blended text composites cleanly
  // on top — opaque glyph pixels cover the path while transparent regions
  // (letter loops in O, D, etc.) still reveal the neon line underneath.
  pathLine.renderOrder = _orders.PATH_LINE;
  scene.add(pathLine);

  var pathSegmentCount = 0;            // tracks how many segments are live
  var _pathColorsBuf   = new Float32Array(0);
  var _pathHsl         = new THREE.Color();

  function _updatePathLine() {
    if (!gemWorldPos || !currentSelection) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    var pts = computePathPoints(
      currentSelection,
      { x: gemWorldPos.x, z: gemWorldPos.z },
      streetsByDirPath
    );
    if (pts.length < 2) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    // LineSegments2 wants PAIRS of vertices — one segment per pair. So
    // duplicate intermediate points: [p0,p1, p1,p2, p2,p3, ...].
    var elev = PATH_LINE.get().ELEVATION;
    var flat = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    // RECREATE the geometry on every update — empirically Three.js's
    // LineSegmentsGeometry.setPositions can leave stale instance state
    // when segment count changes between calls (segments silently dropped).
    if (pathLineGeo && pathLineGeo.dispose) pathLineGeo.dispose();
    pathLineGeo = new LineSegmentsGeometry();
    pathLineGeo.setPositions(flat);
    pathLine.geometry = pathLineGeo;

    pathSegmentCount = pts.length - 1;
    if (_pathColorsBuf.length !== pathSegmentCount * 6) {
      _pathColorsBuf = new Float32Array(pathSegmentCount * 6);
    }
    pathLine.visible = true;
    pathLineMat.opacity = PATH_LINE.get().OPACITY;
  }

  // _updatePathRainbow(t) — per-frame chase: each segment's start+end
  // hues are offset by 1/N around the wheel; t advances every frame.
  function _updatePathRainbow(t) {
    if (!pathLine.visible || pathSegmentCount === 0) return;
    var rb = RAINBOW.get();
    var n = pathSegmentCount;
    for (var s = 0; s < n; s++) {
      var h1 = ((t + s       / n) % 1 + 1) % 1;
      var h2 = ((t + (s + 1) / n) % 1 + 1) % 1;
      _pathHsl.setHSL(h1, rb.SATURATION, rb.LIGHTNESS);
      _pathColorsBuf[s * 6]     = _pathHsl.r;
      _pathColorsBuf[s * 6 + 1] = _pathHsl.g;
      _pathColorsBuf[s * 6 + 2] = _pathHsl.b;
      _pathHsl.setHSL(h2, rb.SATURATION, rb.LIGHTNESS);
      _pathColorsBuf[s * 6 + 3] = _pathHsl.r;
      _pathColorsBuf[s * 6 + 4] = _pathHsl.g;
      _pathColorsBuf[s * 6 + 5] = _pathHsl.b;
    }
    pathLineGeo.setColors(_pathColorsBuf);
  }

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
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width)  * 2 - 1;
    pointer.y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(getPickables(), false);

    if (hits.length > 0) {
      var hit = hits[0];
      var ud  = hit.object.userData;
      // Gem click → reset view only. Doesn't select anything (just gets
      // the user back to the default home framing with whatever sidebar
      // state they had cleared).
      if (ud.type === NODE_KIND.GEM) {
        closeSidebar();    // close handler clears selection too
        resetView();
        return;
      }
      if (ud.building && ud.building.file) {
        if (ud.building.file.type === NODE_KIND.DIRECTORY) {
          // Directory buildings aren't actually rendered (engine.js skips
          // them), but if the data ever shows up just open the sidebar.
          showDirSidebar(ud.building.file);
        } else {
          _setSelection({
            kind: NODE_KIND.FILE,
            mesh: hit.object,
            data: ud.building,
            file: ud.building.file
          });
          showFileSidebar(ud.building.file);
        }
        return;
      }
      if (ud.street && ud.street.dir) {
        _setSelection({
          kind:     'directory',
          sidewalk: hit.object,
          street:   ud.street,
          dir:      ud.street.dir
        });
        showDirSidebar(ud.street.dir);
        return;
      }
    }
    closeSidebar();   // close handler clears selection too
  }

  // ---- Selection persistence ----
  // Saved by file.path or dir.path (the only stable identifiers across
  // reloads — mesh references can't survive). On boot, after the scene's
  // path lookups are built, _restoreSavedSelection() walks the saved kind
  // back into a real {kind, mesh, data, file} or {kind, sidewalk, street,
  // dir} object and re-runs the selection flow.
  var SAVED_SELECTION_KEY = 'cc.selection';
  function _saveSelection(sel) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (!sel) {
        localStorage.removeItem(SAVED_SELECTION_KEY);
        return;
      }
      var snap;
      if (sel.kind === NODE_KIND.FILE && sel.file && sel.file.path != null) {
        snap = { kind: 'file', path: sel.file.path };
      } else if (sel.kind === NODE_KIND.DIRECTORY && sel.dir && sel.dir.path != null) {
        snap = { kind: 'directory', path: sel.dir.path };
      } else {
        return;
      }
      localStorage.setItem(SAVED_SELECTION_KEY, JSON.stringify(snap));
    } catch (_) { /* private mode / quota — drop silently */ }
  }

  // _setSelection(sel) — single entry point for changing what's selected.
  // sel is null OR { kind:'file', mesh, data, file } OR
  //                { kind:'directory', sidewalk, street, dir }.
  //
  // Updates the live outlines + sidewalk tints + neon path line, then
  // persists the selection (by path) so a reload picks it back up.
  function _setSelection(sel) {
    if (currentSelection && currentSelection.kind === NODE_KIND.FILE) {
      selectedOutline.visible = false;
    }
    currentSelection = sel;
    if (sel && sel.kind === NODE_KIND.FILE) {
      _syncOutlineToBuilding(selectedOutline, sel.mesh, sel.data);
      selectedOutline.visible = true;
    }
    _refreshSidewalkTints();
    _updatePathLine();
    _saveSelection(sel);
  }

  // _setHover(h) — single entry point for hover. Independent of selection
  // (you can hover one thing while selecting another); coordinates via
  // _refreshSidewalkTints() which picks the right per-street tint.
  function _setHover(h) {
    if (currentHover && currentHover.kind === NODE_KIND.FILE) {
      hoverOutline.visible = false;
    }
    currentHover = h;
    if (h && h.kind === NODE_KIND.FILE &&
        (!currentSelection || currentSelection.mesh !== h.mesh)) {
      _syncOutlineToBuilding(hoverOutline, h.mesh, h.data);
      hoverOutline.visible = true;
    }
    _refreshSidewalkTints();
  }

  // Any path that closes the sidebar (X button, Esc, click-empty) clears
  // selection too. Single source of truth — every close path behaves the
  // same way.
  setSidebarCloseHandler(function () { _setSelection(null); });

  // _syncOutlineToBuilding(outline, mesh, b, scaleFactor=1) — match outline's
  // transform to a building's CURRENT visual size. scaleFactor > 1 expands
  // outward for the "halo" outline that sits just outside the building edges.
  function _syncOutlineToBuilding(outline, mesh, b, scaleFactor) {
    var s = scaleFactor || 1;
    outline.scale.set(b.w * s, b.h * mesh.scale.y * s, b.d * s);
    outline.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
  }

  // Double-click + F dispatch by what's under the cursor:
  //   - building → frame the door face head-on
  //   - street   → square the street to screen-horizontal and zoom in for
  //                navigating it
  //   - empty    → ignored (focus only acts on real pickable objects)
  canvas.addEventListener('dblclick', function (e) {
    var rect = canvas.getBoundingClientRect();
    var ndcX =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    var ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    _focusAtPointer(ndcX, ndcY);
  });

  function _focusAtPointer(ndcX, ndcY) {
    pointer.set(ndcX, ndcY);
    raycaster.setFromCamera(pointer, camera);

    var hits = raycaster.intersectObjects(getPickables(), false);
    if (hits.length === 0) return;

    var hit = hits[0];
    var ud  = hit.object.userData;
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

  // _recenterPivotToPoint(p) — slide pivot to p; camera shifts by the same
  // delta so the visible scene doesn't zoom or rotate, just slides under.
  function _recenterPivotToPoint(p) {
    camera.up.set(0, 1, 0);
    var delta = p.clone().sub(controls.target);
    _animateCamera(p, camera.position.clone().add(delta), CAMERA_ANIMATION.get().RECENTER_DURATION_MS);
  }

  // _focusOnBuilding(mesh, b) — frame the building's door face head-on.
  // Pivot is the building centroid (b.x, b.h/2, b.y) so subsequent orbit
  // circles around the building. Camera sits along the door's outward
  // normal at a distance that fits the visible face (width × height) in
  // the viewport with modest padding. Stores the mesh as the X-ray focus
  // so the per-frame pass fades obstructors between camera and building.
  //
  // To avoid landing the camera with another building blocking the view,
  // we test sight-line at increasing elevations (0°, 20°, 40°, ...) and
  // use the first clear angle. Combined with per-frame X-ray, this almost
  // always gives an unobstructed look at the target.
  function _focusOnBuilding(mesh, b) {
    camera.up.set(0, 1, 0);   // reset (street focus may have changed it)
    var camAnim = CAMERA_ANIMATION.get();
    var doorDX = 0, doorDZ = 0, faceW;
    if      (b.orient === BUILDING_ORIENT.SOUTH) { doorDZ =  1; faceW = b.w; }
    else if (b.orient === BUILDING_ORIENT.NORTH) { doorDZ = -1; faceW = b.w; }
    else if (b.orient === BUILDING_ORIENT.EAST)  { doorDX =  1; faceW = b.d; }
    else if (b.orient === BUILDING_ORIENT.WEST)  { doorDX = -1; faceW = b.d; }
    else                                          { doorDZ =  1; faceW = b.w; }
    var faceH = b.h;

    var halfV = (camera.fov * Math.PI / 180) / 2;
    var halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    var distForH = (faceH / 2) / Math.tan(halfV);
    var distForW = (faceW / 2) / Math.tan(halfH);
    var dist = Math.max(distForH, distForW) * camAnim.BUILDING_FOCUS_DISTANCE_MULT + camAnim.BUILDING_FOCUS_DISTANCE_OFFSET;

    var halfDepth = (b.orient === BUILDING_ORIENT.EAST || b.orient === BUILDING_ORIENT.WEST) ? b.w / 2 : b.d / 2;
    var newTarget = new THREE.Vector3(b.x, b.h / 2, b.y);

    // Try head-on first; raise camera SIGHTLINE_STEP_DEG at a time if obstructed.
    var newCamPos = null;
    for (var attempt = 0; attempt < SIGHTLINE_MAX_ATTEMPTS; attempt++) {
      var elev = (attempt * SIGHTLINE_STEP_DEG) * Math.PI / 180;
      var horiz = dist * Math.cos(elev);
      var vert  = b.h / 2 + dist * Math.sin(elev);
      var candidate = new THREE.Vector3(
        b.x + doorDX * (halfDepth + horiz),
        vert,
        b.y + doorDZ * (halfDepth + horiz)
      );
      if (_isSightClear(candidate, newTarget, mesh)) {
        newCamPos = candidate;
        break;
      }
      newCamPos = candidate;   // keep the highest attempt as fallback
    }

    _animateCamera(newTarget, newCamPos, camAnim.BUILDING_FOCUS_DURATION_MS);
  }

  // _isSightClear(camPos, target, focusedMesh) — does a ray from camPos to
  // target hit any building besides focusedMesh? Used by _focusOnBuilding
  // to pick a camera position with an unobstructed view.
  function _isSightClear(camPos, target, focusedMesh) {
    _xrayDir.subVectors(target, camPos).normalize();
    _xrayRay.set(camPos, _xrayDir);
    _xrayRay.far = camPos.distanceTo(target) - SIGHTLINE_FAR_OFFSET;
    var hits = _xrayRay.intersectObjects(buildingMeshes, false);
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].object !== focusedMesh) return false;
    }
    return true;
  }

  // _focusOnStreet(s) — orient camera so the street runs left-right across
  // the screen and zoom in to a navigable distance. Camera offset is along
  // the street's PERPENDICULAR axis on whichever side the camera currently
  // sits, so the transition is short and the user keeps their bearings.
  function _focusOnStreet(s, hitPoint) {
    // If the user double-clicked a specific spot, center above THAT spot
    // (clamped to the street's centerline along its long axis so the road
    // still runs cleanly horizontal). Without a hit point, fall back to
    // the street's geometric center.
    var tx = s.x, tz = s.y;
    if (hitPoint) {
      if (s.orientation === 'x') tx = hitPoint.x;   // slide along X
      else                       tz = hitPoint.z;   // slide along Z
    }
    var newTarget = new THREE.Vector3(tx, 0, tz);

    // True top-down framing. Camera nearly vertical, well above the
    // tallest building so nothing can obstruct the street from this angle.
    //
    // Camera orientation rules:
    //   1. Road runs HORIZONTAL on screen (always). camera.up must be
    //      perpendicular to the road's long axis in the XZ plane.
    //   2. Gem appears at TOP of screen. Camera.up sign is chosen so the
    //      gem's perpendicular component lands on the +screen-up side.
    //   3. If gem is purely along the road axis (no perpendicular
    //      component), default sign +1 — gem will appear at LEFT or
    //      RIGHT instead of TOP.
    // OrbitControls computes its up-quaternion ONCE at init and ignores
    // later camera.up changes — so we can't use camera.up to spin the
    // screen. Instead keep camera.up = world Y always, and control screen
    // orientation via the camera's horizontal OFFSET direction.
    //
    // With default up + top-down view: screen-up direction in world =
    // OPPOSITE of camera's horizontal offset direction (camera tilts
    // back toward target, so the "far" side of target is at top of frame).
    // Screen-right axis follows from that.
    //
    // Rules (gem must end up at TOP or LEFT, road horizontal):
    //   x-street (road along X): camera offset is on Z axis. Sign chosen so:
    //     - perpendicular gem (gem.z ≠ s.y): offset OPPOSITE of gem.z
    //       → gem ends up at TOP.
    //     - along-axis gem  (gem.z = s.y, e.g. focusing on root street
    //       itself): offset = +Z if gem.x ≤ s.x (smaller X = LEFT under
    //       this orientation), else -Z (flips screen so larger X = LEFT).
    //   y-street: mirror with X/Z swapped.
    // Uniform compass: road horizontal, gem at WEST (x-streets) or
    // NORTH (y-streets). With default world-up, camera at +offset puts
    // smaller world coords on the +screen-up / +screen-right SIDE of the
    // frame closer to the gem (which lives near origin = -X relative to
    // most focused streets). Always-positive offsets give that.
    var offX = 0, offZ = 0;
    if (s.orientation === 'x') {
      offZ = 1;    // gem at west (left)
    } else {
      offX = 1;    // gem at north (top)
    }
    camera.up.set(0, 1, 0);             // stay world-up for OrbitControls

    // Camera altitude must clear every building. Compute max building
    // height (factoring in current scale.y from any in-progress toggle).
    var maxBldgH = 0;
    for (var i = 0; i < buildingMeshes.length; i++) {
      var mb = buildingMeshes[i].userData.building;
      var sy = buildingMeshes[i].scale.y || 1;
      var bh = (mb && mb.h ? mb.h : 0) * sy;
      if (bh > maxBldgH) maxBldgH = bh;
    }

    var camAnim = CAMERA_ANIMATION.get();
    var halfV = (camera.fov * Math.PI / 180) / 2;
    var halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    var distForLength = (s.length * camAnim.STREET_FOCUS_LENGTH_FRAC / 2) / Math.tan(halfH);
    var distForWidth  = (s.width  * camAnim.STREET_FOCUS_WIDTH_MULT  / 2) / Math.tan(halfV);
    var altitude = Math.max(distForLength, distForWidth,
                            maxBldgH * camAnim.STREET_FOCUS_ALTITUDE_BLDG_MULT + camAnim.STREET_FOCUS_ALTITUDE_FLOOR);

    // Near-vertical elevation — just under OrbitControls' polar limit so
    // the camera doesn't snap on the next update. Camera sits at +offX /
    // +offZ horizontal offset; with default world-up, screen-up is the
    // OPPOSITE direction (target's "far side" appears at top).
    var elev = camAnim.STREET_FOCUS_ELEVATION_DEG * Math.PI / 180;
    var horizDist = altitude / Math.tan(elev);

    var newCamPos = new THREE.Vector3(
      tx + offX * horizDist,
      altitude,
      tz + offZ * horizDist
    );
    _animateCamera(newTarget, newCamPos, camAnim.STREET_FOCUS_DURATION_MS);
  }

  function _animateCamera(newTarget, newCamPos, duration) {
    var token = ++camAnimToken;
    var startTarget = controls.target.clone();
    var startCamPos = camera.position.clone();
    var t0 = performance.now();
    var easingPower = CAMERA_ANIMATION.get().EASING_POWER;

    function step() {
      if (camAnimToken !== token) return;       // superseded by a newer animation
      var elapsed = performance.now() - t0;
      var t = elapsed / duration;
      if (t >= 1) t = 1;
      var eased = 1 - Math.pow(1 - t, easingPower);
      controls.target.lerpVectors(startTarget, newTarget, eased);
      camera.position.lerpVectors(startCamPos, newCamPos, eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function resetView() {
    // Clear any persisted pose so this is a true "fresh start" — cancel
    // pending save first, since the animation's 'change' events will
    // schedule a new save (with the default pose, which is correct).
    if (_saveCameraTimer) { clearTimeout(_saveCameraTimer); _saveCameraTimer = 0; }
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVED_CAMERA_KEY);
    } catch (_) { /* private mode / unavailable — ignore */ }
    camera.up.set(0, 1, 0);           // back to default world-up
    _animateCamera(initialTarget.clone(), initialCamPos.clone(), CAMERA_ANIMATION.get().RESET_DURATION_MS);
  }

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
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(getPickables(), false);

    var newHover = null, tooltipText = null;
    if (hits.length > 0) {
      var h0 = hits[0];
      var ud = h0.object.userData;
      if (ud.type === NODE_KIND.GEM) {
        newHover = { kind: NODE_KIND.GEM };
        var rootName = (rootStreet && rootStreet.dir && rootStreet.dir.name) || 'root';
        tooltipText = 'root  ·  ' + rootName;
      } else if (ud.building && ud.building.file && ud.building.file.type === NODE_KIND.FILE) {
        var f = ud.building.file;
        newHover = { kind: NODE_KIND.FILE, mesh: h0.object, data: ud.building, file: f };
        tooltipText = f.name + (f.lines != null ? '  ·  ' + f.lines + ' lines' : '');
      } else if (ud.street && ud.street.dir) {
        var d = ud.street.dir;
        var n = (d.descendants_count != null) ? d.descendants_count : (d.children_count || 0);
        newHover = { kind: NODE_KIND.DIRECTORY, sidewalk: h0.object, street: ud.street, dir: d };
        tooltipText = (d.name || 'directory') + '  ·  ' + n + ' items';
      }
    }

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
    if (_sameHover(newHover, _hoverPending)) return;   // already queued
    _hoverPending = newHover;
    if (_hoverCommitId) clearTimeout(_hoverCommitId);
    _hoverCommitId = setTimeout(function () {
      _hoverCommitId = 0;
      var toCommit = _hoverPending;
      _hoverPending = null;
      if (!_sameHover(toCommit, currentHover)) _setHover(toCommit);
    }, INPUT_TIMING.get().HOVER_COMMIT_MS);
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
    // LineMaterial.resolution must match viewport for pixel-accurate width.
    hoverLineMat.resolution.set(cw, ch);
    selectedLineMat.resolution.set(cw, ch);
    pathLineMat.resolution.set(cw, ch);
    for (var rmi = 0; rmi < buildingOutlineMats.length; rmi++) {
      buildingOutlineMats[rmi].resolution.set(cw, ch);
    }
  }
  window.addEventListener('resize', onResize);

  document.addEventListener('keydown', function (e) {
    // Don't intercept hotkeys while the user is typing in an input/textarea
    // (none today, but defensive against future controls-panel additions).
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

    if (e.key === 'Escape') {
      closeSidebar();                 // close handler clears selection + focus
    } else if (e.key === 'r' || e.key === 'R' || e.key === 'Home') {
      resetView();
    }
  });

  showLeftSidebar(manifest, {
    onResetView: resetView,
    applyTheme:  applyTheme
  });

  // ---- Restore the previously-selected file/dir, if any ----
  // Runs AFTER showLeftSidebar so the right-hand sidebar is wired up too.
  // If the saved path no longer matches anything in the current tree
  // (file renamed/moved/deleted), drop the entry and start fresh — no
  // way to recover and we don't want stale paths lingering in storage.
  try {
    if (typeof localStorage !== 'undefined') {
      var savedSelRaw = localStorage.getItem(SAVED_SELECTION_KEY);
      if (savedSelRaw) {
        var savedSel = JSON.parse(savedSelRaw);
        var restored = false;
        if (savedSel && savedSel.kind === 'file' && savedSel.path != null) {
          for (var rsi = 0; rsi < buildingMeshes.length; rsi++) {
            var _rm = buildingMeshes[rsi];
            var _rb = _rm.userData.building;
            if (_rb && _rb.file && _rb.file.path === savedSel.path) {
              _setSelection({ kind: NODE_KIND.FILE, mesh: _rm, data: _rb, file: _rb.file });
              showFileSidebar(_rb.file);
              restored = true;
              break;
            }
          }
        } else if (savedSel && savedSel.kind === 'directory' && savedSel.path != null) {
          var sw = sidewalksByDirPath[savedSel.path];
          var sStreet = streetsByDirPath[savedSel.path];
          if (sw && sStreet && sStreet.dir) {
            _setSelection({
              kind:     NODE_KIND.DIRECTORY,
              sidewalk: sw,
              street:   sStreet,
              dir:      sStreet.dir
            });
            showDirSidebar(sStreet.dir);
            restored = true;
          }
        }
        if (!restored) localStorage.removeItem(SAVED_SELECTION_KEY);
      }
    }
  } catch (_) { /* corrupt JSON — ignore */ }

  // -- 8. Render loop --------------------------------------------------------
  var startTime = performance.now();
  var labelRight = new THREE.Vector3();
  // Reusable scratch objects for the sight-line raycast in _isSightClear.
  var _xrayRay = new THREE.Raycaster();
  var _xrayDir = new THREE.Vector3();

  // _updateXRayAndOutlines() — runs every frame. Two jobs:
  //   1. X-ray: while a building is focused, fade ANY building whose
  //      screen-space silhouette overlaps the focused building's silhouette
  //      AND is closer to the camera. This catches every visually-blocking
  //      building, regardless of where they sit in 3D — much more robust
  //      than ray sampling, which misses obstructors that don't happen to
  //      lie on the test rays.
  //   2. Outlines: keep hover + selected outlines synced to their mesh's
  //      current visual size.
  function _updateXRayAndOutlines() {
    // CRITICAL: refresh world matrices before projecting. controls.update()
    // moved the camera but matrixWorldInverse is stale until renderer.render
    // runs at end-of-frame. Without this, .project() returns wrong NDC and
    // the screen-space obstructor test misses everything.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();

    // ---- 1. Visibility ----
    // Building selected/focused: fade obstructors only (buildings whose
    //   silhouette overlaps the selected building's silhouette AND are
    //   closer in NDC depth). Selected stays at 1.0; clear buildings stay
    //   at 1.0; only obstructors fade.
    // Street selected: TIERED fade based on directory tree (SimCity 2013
    //   "data view" pattern):
    //     direct children files      → 1.00
    //     descendants (sub-dirs)     → 0.45
    //     unrelated                  → 0.10
    // Read fade targets from the unified selection state. Building
    // selection ALSO triggers tiered fade — the file's parent dir acts
    // as the "neighborhood" so the user sees siblings + descendants
    // exactly like a street selection. The selected building itself
    // stays fully solid on top.
    var bldgTarget = (currentSelection && currentSelection.kind === NODE_KIND.FILE)
      ? currentSelection.mesh : null;
    var dirTarget = null;
    if (currentSelection) {
      if (currentSelection.kind === NODE_KIND.DIRECTORY) {
        dirTarget = currentSelection.dir;
      } else if (currentSelection.kind === NODE_KIND.FILE) {
        var parentPath = parentDirPath(currentSelection.file.path);
        if (parentPath != null) {
          var parentStreet = streetsByDirPath[parentPath];
          if (parentStreet) dirTarget = parentStreet.dir;
        }
      }
    }
    // Hover preview: hovering a street OR a building previews the EXACT
    // same fade that a click would produce. For a building, the file's
    // parent dir becomes the dirTarget — same lookup the selection path
    // uses. Wins over the active selection's dirTarget while hovering,
    // so the user can see what's down THAT street / around THAT building
    // before committing; when the mouse leaves, fade snaps back to the
    // selection.
    if (currentHover) {
      if (currentHover.kind === NODE_KIND.DIRECTORY &&
          currentHover.street && currentHover.street.dir) {
        dirTarget = currentHover.street.dir;
      } else if (currentHover.kind === NODE_KIND.FILE && currentHover.file) {
        var hoverParent = parentDirPath(currentHover.file.path);
        if (hoverParent != null) {
          var hoverStreet = streetsByDirPath[hoverParent];
          if (hoverStreet) dirTarget = hoverStreet.dir;
        }
      }
    }
    var hoverMesh  = (currentHover && currentHover.kind === NODE_KIND.FILE)
      ? currentHover.mesh : null;

    // Two faded tiers, both windowless (the GHOST_THRESHOLD below is set
    // Per-tier style: detail (full / silhouette / hidden) + outline (on/off)
    // + opacity (overall multiplier). Fetched once per frame.
    var fadeCfg = BUILDING_FADE.get();

    // Obstruction detection (NDC silhouette overlap) was previously here;
    // tiered fade alone covers the visibility need, so it was deleted.

    for (var bi = 0; bi < buildingMeshes.length; bi++) {
      var m = buildingMeshes[bi];

      // Init per-layer lerp state. Each layer (body / ghost / outline)
      // animates independently toward its tier-derived target; that lets
      // a tier with detail='silhouette' smoothly fade body→0 + ghost→opacity
      // when the user makes a new selection.
      if (m.userData.bodyOp    == null) m.userData.bodyOp    = 1.0;
      if (m.userData.ghostOp   == null) m.userData.ghostOp   = 0.0;
      if (m.userData.outlineOp == null) m.userData.outlineOp = 0.0;

      // ---- Decide which tier this building falls into ----
      var detail, outlineOn, bodyOpacity, outlineOpacity;
      if (m === bldgTarget) {
        // Selected file building: always full, opaque, no default outline
        // (selectedOutline draws the rainbow chasing on its own pass).
        detail         = 'full';
        outlineOn      = false;
        bodyOpacity    = 1.0;
        outlineOpacity = 0;
      } else if (dirTarget) {
        // Tier by directory-tree distance from the building's parent dir
        // to the selected/hovered dir: 0 = sibling, 1 = one hop, ≥2 = far.
        var f = m.userData.building && m.userData.building.file;
        var dist = _dirTreeDistance(f, dirTarget);
        if (dist === 0) {
          detail = fadeCfg.DEFAULT_DETAIL;  outlineOn = fadeCfg.DEFAULT_OUTLINE;
          bodyOpacity    = fadeCfg.DEFAULT_BODY_OPACITY;
          outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
        } else if (dist === 1) {
          detail = fadeCfg.NEAR_DETAIL;     outlineOn = fadeCfg.NEAR_OUTLINE;
          bodyOpacity    = fadeCfg.NEAR_BODY_OPACITY;
          outlineOpacity = fadeCfg.NEAR_OUTLINE_OPACITY;
        } else {
          detail = fadeCfg.FAR_DETAIL;      outlineOn = fadeCfg.FAR_OUTLINE;
          bodyOpacity    = fadeCfg.FAR_BODY_OPACITY;
          outlineOpacity = fadeCfg.FAR_OUTLINE_OPACITY;
        }
      } else {
        // No selection — uniform Default look.
        detail         = fadeCfg.DEFAULT_DETAIL;
        outlineOn      = fadeCfg.DEFAULT_OUTLINE;
        bodyOpacity    = fadeCfg.DEFAULT_BODY_OPACITY;
        outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
      }

      // Hover preview: a hovered file building is rendered using the
      // DEFAULT tier styling regardless of which tier it would otherwise
      // sit in. Hover acts as a "preview the selection" state — single
      // source of truth, no separate hover-floor knob.
      if (m === hoverMesh) {
        detail         = fadeCfg.DEFAULT_DETAIL;
        outlineOn      = fadeCfg.DEFAULT_OUTLINE;
        bodyOpacity    = fadeCfg.DEFAULT_BODY_OPACITY;
        outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
      }

      // ---- Translate (detail, outline, opacities) → per-layer targets ----
      var bodyTarget    = (detail === 'full')       ? bodyOpacity    : 0;
      var ghostTarget   = (detail === 'silhouette') ? bodyOpacity    : 0;
      var outlineTarget = outlineOn                 ? outlineOpacity : 0;

      // Lerp each layer toward its target. SNAP_THRESHOLD lets us stop
      // animating once we're close enough — saves redundant material updates.
      m.userData.bodyOp    = _stepOpacity(m.userData.bodyOp,    bodyTarget,    fadeCfg);
      m.userData.ghostOp   = _stepOpacity(m.userData.ghostOp,   ghostTarget,   fadeCfg);
      m.userData.outlineOp = _stepOpacity(m.userData.outlineOp, outlineTarget, fadeCfg);

      var b = m.userData.building;

      // ---- Body (textured mesh: walls, windows, doors) ----
      // Per-material — buildings have one material per face. material.transparent
      // triggers a shader recompile, so only flip it when it actually changed.
      var bodyOp = m.userData.bodyOp;
      var mats = Array.isArray(m.material) ? m.material : [m.material];
      var bodyTransparent = bodyOp < OPAQUE_THRESHOLD;
      for (var ki = 0; ki < mats.length; ki++) {
        var mat = mats[ki];
        if (mat.transparent !== bodyTransparent) {
          mat.transparent = bodyTransparent;
          mat.depthWrite  = !bodyTransparent;
          mat.needsUpdate = true;
        }
        mat.opacity = bodyOp;
      }
      m.visible = bodyOp > 0;

      // ---- Outline (per-building wireframe) ----
      var outline = buildingOutlines[bi];
      if (outline) {
        outline.scale.set(b.w, b.h * (m.scale.y || 1), b.d);
        outline.position.copy(m.position);
        outline.material.opacity = m.userData.outlineOp;
        outline.visible = m.userData.outlineOp > 0;
      }

      // ---- Ghost (windowless solid silhouette) ----
      var ghost = buildingGhosts[bi];
      if (ghost) {
        ghost.scale.set(b.w, b.h * (m.scale.y || 1), b.d);
        ghost.position.copy(m.position);
        ghost.material.opacity = m.userData.ghostOp;
        ghost.visible = m.userData.ghostOp > 0;
      }
    }

    // ---- 2. Outlines (sync + flowing rainbow color update) ----
    if (currentSelection && currentSelection.kind === NODE_KIND.FILE) {
      _syncOutlineToBuilding(selectedOutline, currentSelection.mesh, currentSelection.data);
      // Bottom (segments 0-3) and top (4-7) form continuous 4-edge loops
      // around the box. Each segment gets a START hue matching the previous
      // segment's END hue, so colors flow seamlessly around the loop. The
      // shared `t` advances every frame → entire spectrum chases around the
      // building. Vertical edges (8-11) take a single hue from their
      // corresponding bottom corner so the verticals colors-match the loop
      // they connect to.
      var t = performance.now() * RAINBOW.get().SPEED;
      _setSegHueGradient(0, t + 0.00, t + 0.25);  // bottom: back  edge
      _setSegHueGradient(1, t + 0.25, t + 0.50);  // bottom: right edge
      _setSegHueGradient(2, t + 0.50, t + 0.75);  // bottom: front edge
      _setSegHueGradient(3, t + 0.75, t + 1.00);  // bottom: left  edge
      _setSegHueGradient(4, t + 0.00, t + 0.25);  // top:    back  edge
      _setSegHueGradient(5, t + 0.25, t + 0.50);  // top:    right edge
      _setSegHueGradient(6, t + 0.50, t + 0.75);  // top:    front edge
      _setSegHueGradient(7, t + 0.75, t + 1.00);  // top:    left  edge
      _setSegHueGradient(8,  t + 0.00, t + 0.00); // vertical: back-left
      _setSegHueGradient(9,  t + 0.25, t + 0.25); // vertical: back-right
      _setSegHueGradient(10, t + 0.50, t + 0.50); // vertical: front-right
      _setSegHueGradient(11, t + 0.75, t + 0.75); // vertical: front-left
      _selColorBuf.array.set(_selectedColors);
      _selColorBuf.needsUpdate = true;
    }
    if (currentHover && currentHover.kind === NODE_KIND.FILE &&
        (!currentSelection || currentSelection.mesh !== currentHover.mesh)) {
      _syncOutlineToBuilding(hoverOutline, currentHover.mesh, currentHover.data);
    }
  }

  function animate() {
    controls.update();
    _updateXRayAndOutlines();
    _updatePathRainbow(performance.now() * RAINBOW.get().SPEED);
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


// Exported for testability. Reads a <script type="application/json" id="X">
// tag and parses its contents. index.html holds these as placeholder text
// (filled by build.sh at skill runtime, or by the vite dev plugin at dev time).
export function readEmbeddedJson(id) {
  var el = document.getElementById(id);
  if (!el) throw new Error('readEmbeddedJson: missing <script id="' + id + '">');
  try {
    return JSON.parse(el.textContent);
  } catch (e) {
    throw new Error('readEmbeddedJson: invalid JSON in <script id="' + id + '">: ' + e.message);
  }
}

// Boot. If main.js is imported from a test, the top-level code still runs
// but typical test environments won't have the script tags + canvas wired up,
// so tests should import only { readEmbeddedJson } and not trigger the boot.
// We guard with a feature check to make that safe.
var _canvas = document.getElementById(DOM_IDS.CANVAS);
if (_canvas) {
  var manifest = readEmbeddedJson(DOM_IDS.EMBEDDED_MANIFEST);
  // Hydrate every config store from localStorage BEFORE scene build so
  // any user tweaks from prior sessions take effect during the initial
  // layout/render. Config namespace import provides every named store.
  attachPersistence(Config);
  startRenderLoop(_canvas, manifest);
}

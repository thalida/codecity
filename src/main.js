// main.js — Entry point. Reads MANIFEST/CONFIG embedded in index.html,
// lays out the city, builds the scene, and starts the render loop with
// orbit/pan/zoom controls and raycast picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 }      from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }       from 'three/addons/lines/LineMaterial.js';
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

import { buildCityScene } from './scene/engine.js';
import { layoutCity } from './scene/layout.js';
import { getBuildingColor, getDateRanges } from './scene/colors.js';
import { showFileSidebar, showDirSidebar, closeSidebar, setSidebarPalette, setSidebarCloseHandler } from './components/sidebar.js';
import { showLeftSidebar } from './components/leftSidebar.js';
import { showTooltip, hideTooltip } from './components/tooltip.js';
import {
  parentDirPath,
  streetChainForDirPath,
  computePathPoints
} from './scene/path.js';


function startRenderLoop(canvas, manifest, config) {
  // -- 0. Resolve scene config knobs ------------------------------------------
  // Every visual tunable below is sourced from config.scene.*; literals here
  // are fallbacks for missing keys so the renderer still works without a
  // config (e.g. tests). Anything tweak-worthy lives in defaults.json under
  // `scene.*` — DO NOT inline new color/opacity/linewidth literals; surface
  // them through this block so designers can adjust without code edits.
  var sceneCfg     = (config && config.scene) || {};
  var sidewalkCfg  = sceneCfg.sidewalk || {};
  var outlineCfg   = sceneCfg.outline  || {};
  var fadeCfg      = sceneCfg.fade     || {};
  var fadeNear     = fadeCfg.tier_near || {};
  var fadeFar      = fadeCfg.tier_far  || {};
  var CFG_SIDEWALK_HOVER    = sidewalkCfg.hover    || '#d0d2da';
  var CFG_SIDEWALK_SELECTED = sidewalkCfg.selected || '#ffffff';
  var CFG_SIDEWALK_PATH     = sidewalkCfg.path     || '#4a4c54';
  var CFG_OUTLINE_HOVER_COLOR    = outlineCfg.hover_color        || '#ffffff';
  var CFG_OUTLINE_DEFAULT_LW     = outlineCfg.default_linewidth  || 3;
  var CFG_OUTLINE_HOVER_LW       = outlineCfg.hover_linewidth    || 2;
  var CFG_OUTLINE_SELECTED_LW    = outlineCfg.selected_linewidth || 4;
  var CFG_FADE_LERP    = (fadeCfg.lerp_speed != null)  ? fadeCfg.lerp_speed  : 0.18;
  var CFG_FADE_TOP     = (fadeCfg.fade_top != null)    ? fadeCfg.fade_top    : 1.0;
  var CFG_FADE_BOTTOM  = (fadeCfg.fade_bottom != null) ? fadeCfg.fade_bottom : 0.7;
  var CFG_TIER_NEAR    = {
    main:    (fadeNear.main    != null) ? fadeNear.main    : 0.65,
    outline: (fadeNear.outline != null) ? fadeNear.outline : 0.40,
    ghost:   (fadeNear.ghost   != null) ? fadeNear.ghost   : 0.85
  };
  var CFG_TIER_FAR     = {
    main:    (fadeFar.main    != null) ? fadeFar.main    : 0.18,
    outline: (fadeFar.outline != null) ? fadeFar.outline : 0.12,
    ghost:   (fadeFar.ghost   != null) ? fadeFar.ghost   : 0.20
  };
  var CFG_HOVER_COMMIT_MS = (sceneCfg.hover_commit_ms != null)
    ? sceneCfg.hover_commit_ms : 35;

  // -- 1. Layout + colors ------------------------------------------------------
  var layout     = layoutCity(manifest.tree, config);
  var dateRanges = getDateRanges(manifest.tree);
  var hueExtMap  = (config.building && config.building.hue_ext_map) || {};
  setSidebarPalette(hueExtMap);

  for (var i = 0; i < layout.buildings.length; i++) {
    var b = layout.buildings[i];
    if (b.file && b.file.type === 'file') {
      b.color = getBuildingColor(b.file, hueExtMap, dateRanges, config);
    } else {
      b.color = 'hsl(220, 15%, 25%)';
    }
  }

  // -- 2. Scene ----------------------------------------------------------------
  var built = buildCityScene(layout, config);
  var scene = built.scene;
  var buildingMeshes  = built.buildingMeshes;
  var streetPickables = built.streetPickables;
  var streetLabels    = built.streetLabels;
  var pathMeshes      = built.pathMeshes || [];
  var rootGem         = built.rootGem;
  // pickables is rebuilt on every height-mode toggle (since building meshes
  // are disposed + replaced), so we wrap the array in a getter-style closure
  // and pass `getPickables()` to the raycaster.
  var pickables = buildingMeshes.concat(streetPickables);
  // Gem is also clickable — click acts as a "reset view to start" gesture
  // (city's signature landmark doubles as a home button).
  if (rootGem) {
    var gemBody = rootGem.children && rootGem.children[0];
    if (gemBody) {
      gemBody.userData.type = 'root-gem';
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
    var _bcol = new THREE.Color(_bd.color || '#888888');

    var _olGeo = new LineSegmentsGeometry();
    _olGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
    var _olMat = new LineMaterial({
      color:       _bcol.clone(),
      linewidth:   CFG_OUTLINE_DEFAULT_LW,
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
  var camera = new THREE.PerspectiveCamera(45, W / Math.max(1, H), 1, 20000);

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
    if (rootStreet.orientation === 'x') {
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
  // the pivot is offset from bbox center. 0.95 multiplier gives the city
  // tight, comfortable framing (1.4 was overly padded — city was lost in
  // black space).
  var farX = Math.max(Math.abs(bbox.max.x - groundCenter.x), Math.abs(bbox.min.x - groundCenter.x));
  var farY = Math.max(Math.abs(bbox.max.y - groundCenter.y), Math.abs(bbox.min.y - groundCenter.y));
  var farZ = Math.max(Math.abs(bbox.max.z - groundCenter.z), Math.abs(bbox.min.z - groundCenter.z));
  var radius = Math.sqrt(farX * farX + farY * farY + farZ * farZ);
  var dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 0.95;

  var dir = new THREE.Vector3(-1, 1, 1).normalize();
  camera.position.copy(groundCenter).add(dir.multiplyScalar(dist));
  camera.lookAt(groundCenter);

  // -- 5. Controls -------------------------------------------------------------
  var controls = new OrbitControls(camera, canvas);
  controls.target.copy(groundCenter);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 30;
  controls.maxDistance = dist * 4;
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.PAN
  };

  // -- 6. Raycaster picking ----------------------------------------------------
  var raycaster = new THREE.Raycaster();
  var pointer   = new THREE.Vector2();

  // Click vs. drag: track pointerdown→pointerup with a movement + time threshold.
  var downX = 0, downY = 0, downTime = 0;
  var CLICK_MOVE_THRESHOLD_SQ = 5 * 5;
  var CLICK_TIME_THRESHOLD    = 400;

  // Reusable infinite ground plane (Y=0) for raycasting empty space.
  var groundPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var groundHit    = new THREE.Vector3();
  var camAnimToken = 0;

  // Pivot ping: a brief expanding-ring "ping" at the new pivot location,
  // shown only at the moment focus changes (dblclick / F / reset). No
  // persistent indicator — that's not how Blender, Maya, SketchUp, or
  // Google Earth do it; rotation pivot is implicit during normal navigation.
  // The ping is feedback for "your pivot moved here" then disappears.
  var pivotPing = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 1.0, 48),
    new THREE.MeshBasicMaterial({
      color:       0x8ea4ff,
      transparent: true,
      opacity:     0.0,         // hidden by default
      depthWrite:  false,
      side:        THREE.DoubleSide
    })
  );
  pivotPing.rotation.x  = -Math.PI / 2;   // lay flat on XZ
  pivotPing.renderOrder = 4;
  pivotPing.position.y  = 0.6;
  pivotPing.visible     = false;
  scene.add(pivotPing);

  // Hover + selection outlines for buildings: ONE shared mesh per state,
  // retransformed to whichever building is currently hovered / selected.
  // LineSegments2 (vs the regular LineSegments) renders as triangle strips
  // so linewidth can actually be set in pixels — regular WebGL lines are
  // locked to 1px, which reads as a faint hairline. ~3px feels much more
  // like a Cities-Skylines selection outline.
  var _unitEdgesGeo = new LineSegmentsGeometry();
  _unitEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);

  var hoverLineMat = new LineMaterial({
    color:      new THREE.Color(CFG_OUTLINE_HOVER_COLOR),
    linewidth:  CFG_OUTLINE_HOVER_LW,
    transparent: true,
    opacity:    0.85,
    depthTest:  true,
    worldUnits: false
  });
  hoverLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  var hoverOutline = new LineSegments2(_unitEdgesGeo, hoverLineMat);
  hoverOutline.visible = false;
  hoverOutline.renderOrder = 5;
  scene.add(hoverOutline);

  // Selected: 3px Line2 outline with per-segment vertex colors so the 12
  // box edges show different hues that ROTATE around the wheel each frame
  // — a chasing-rainbow neon effect. Each segment's start and end share
  // one hue (so the segment is solid-colored), but neighboring segments
  // are offset by 1/12 of the wheel.
  var selectedLineMat = new LineMaterial({
    vertexColors: true,
    linewidth:    CFG_OUTLINE_SELECTED_LW,
    transparent:  true,
    opacity:      1.0,
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
  selectedOutline.renderOrder = 7;
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
    var k = segIdx * 6;
    _tmpHsl.setHSL(((hueStart % 1) + 1) % 1, 1.0, 0.6);
    _selectedColors[k]     = _tmpHsl.r;
    _selectedColors[k + 1] = _tmpHsl.g;
    _selectedColors[k + 2] = _tmpHsl.b;
    _tmpHsl.setHSL(((hueEnd   % 1) + 1) % 1, 1.0, 0.6);
    _selectedColors[k + 3] = _tmpHsl.r;
    _selectedColors[k + 4] = _tmpHsl.g;
    _selectedColors[k + 5] = _tmpHsl.b;
  }


  // Sidewalk tint colors. Each street's sidewalk material starts at
  // config.scene.sidewalk; we mutate material.color directly on hover/select
  // and restore from sidewalk.userData.origColor (lazily captured first time
  // we touch the material).
  // Sidewalk tint variants for hover/selected/path lineage. Sourced from
  // config.scene.sidewalk.{hover,selected,path}; see the CFG_SIDEWALK_*
  // resolution at the top of startRenderLoop. THREE.Color() accepts both
  // hex literals (0xRRGGBB) and CSS color strings, so the JSON values
  // come through unchanged.
  var SIDEWALK_HOVER_COLOR    = new THREE.Color(CFG_SIDEWALK_HOVER).getHex();
  var SIDEWALK_SELECTED_COLOR = new THREE.Color(CFG_SIDEWALK_SELECTED).getHex();
  var SIDEWALK_PATH_COLOR     = new THREE.Color(CFG_SIDEWALK_PATH).getHex();

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
  // hover / path lineage colors).
  var pathMeshesByDirPath = {};
  for (var pmi = 0; pmi < pathMeshes.length; pmi++) {
    var _pm = pathMeshes[pmi];
    var _pmFile = _pm.userData.file;
    var _pmDir  = _pmFile && _pmFile.path != null ? parentDirPath(_pmFile.path) : null;
    if (_pmDir == null) continue;
    if (!pathMeshesByDirPath[_pmDir]) pathMeshesByDirPath[_pmDir] = [];
    pathMeshesByDirPath[_pmDir].push(_pm);
  }

  // _expectedSidewalkTint(sw) — selected / path / hover color, or null for
  // default. Selected wins over path; path wins over hover. The neon line
  // STILL traces the path; the sidewalk tint reinforces the lineage so
  // the user can see which streets are on the chain at a glance.
  function _expectedSidewalkTint(sw) {
    if (currentSelection && currentSelection.kind === 'directory' &&
        currentSelection.sidewalk === sw) {
      return SIDEWALK_SELECTED_COLOR;
    }
    // Hover wins over path tint so parent roads still show a hover response
    // when you mouse over them. Selection still wins over hover above.
    if (currentHover && currentHover.kind === 'directory' &&
        currentHover.sidewalk === sw) {
      return SIDEWALK_HOVER_COLOR;
    }
    if (currentSelection && currentSelection._pathSidewalks &&
        currentSelection._pathSidewalks.indexOf(sw) !== -1) {
      return SIDEWALK_PATH_COLOR;
    }
    return null;
  }

  // Compute the sidewalks on the path from root → selection (excluding the
  // selected sidewalk itself, which gets its own SELECTED tint).
  function _pathSidewalksForSelection(sel) {
    if (!sel) return [];
    var dirPath, includeLast;
    if (sel.kind === 'directory') {
      dirPath = sel.dir.path;
      includeLast = false;            // selected dir's own sidewalk: SELECTED tint
    } else {
      dirPath = parentDirPath(sel.file.path);
      includeLast = true;             // file's parent street: PATH tint
    }
    if (dirPath == null) return [];
    var chain = streetChainForDirPath(dirPath, streetsByDirPath);
    var stop = includeLast ? chain.length : chain.length - 1;
    var path = [];
    for (var i = 0; i < stop; i++) {
      var sw = sidewalksByDirPath[chain[i].dir.path];
      if (sw) path.push(sw);
    }
    return path;
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

  // ---- Neon path line: gem → ... → selection ----
  // Built from independent line segments (LineSegments2) — one segment
  // per leg of the path. Tried Line2 (polyline) first but its mitered
  // bends silently dropped subsequent legs in dynamic updates; segments
  // are more robust. Per-segment vertex colors cycle through the rainbow
  // each frame for the same chasing-neon effect as the building outline.
  var pathLineMat = new LineMaterial({
    vertexColors: true,
    linewidth:    5,
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
  // Render BEFORE labels (which sit at renderOrder 6) so the labels'
  // alpha-blended text composites cleanly on top — opaque glyph pixels
  // cover the path while transparent regions (letter loops in O, D, etc.)
  // still reveal the neon line running underneath.
  pathLine.renderOrder = 4;
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
    var flat = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      flat.push(a.x, 0.3, a.z, b.x, 0.3, b.z);
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
    pathLineMat.opacity = 0.95;
  }

  // _updatePathRainbow(t) — per-frame chase: each segment's start+end
  // hues are offset by 1/N around the wheel; t advances every frame.
  function _updatePathRainbow(t) {
    if (!pathLine.visible || pathSegmentCount === 0) return;
    var n = pathSegmentCount;
    for (var s = 0; s < n; s++) {
      var h1 = ((t + s       / n) % 1 + 1) % 1;
      var h2 = ((t + (s + 1) / n) % 1 + 1) % 1;
      _pathHsl.setHSL(h1, 1.0, 0.65);
      _pathColorsBuf[s * 6]     = _pathHsl.r;
      _pathColorsBuf[s * 6 + 1] = _pathHsl.g;
      _pathColorsBuf[s * 6 + 2] = _pathHsl.b;
      _pathHsl.setHSL(h2, 1.0, 0.65);
      _pathColorsBuf[s * 6 + 3] = _pathHsl.r;
      _pathColorsBuf[s * 6 + 4] = _pathHsl.g;
      _pathColorsBuf[s * 6 + 5] = _pathHsl.b;
    }
    pathLineGeo.setColors(_pathColorsBuf);
  }

  // ---- Selection + hover state (single source of truth) ----
  //
  // Both `currentSelection` and `currentHover` are EITHER null OR an object:
  //   { kind: 'file',      mesh, data, file }       — a file building
  //   { kind: 'directory', sidewalk, street, dir }  — a directory street
  //
  // All visuals (outlines, sidewalk tints, X-ray fades, sidebar contents,
  // tooltip) derive from these two values. State changes go through
  // `_setSelection()` and `_setHover()`, which atomically clear prior
  // visuals before applying new ones — no stale state, no dangling X-ray
  // focus when the user moves on to something else.
  var currentSelection = null;
  var currentHover     = null;

  var pingToken = 0;
  function _pingPivot(worldPos) {
    var token = ++pingToken;
    pivotPing.position.x = worldPos.x;
    pivotPing.position.z = worldPos.z;
    pivotPing.visible = true;
    var t0 = performance.now();
    var duration = 700;
    var startScale = 0.7;
    var endScale   = 4.0;
    var startOpacity = 0.85;
    function step() {
      if (pingToken !== token) return;       // newer ping superseded this one
      var elapsed = performance.now() - t0;
      var t = elapsed / duration;
      if (t >= 1) {
        pivotPing.visible = false;
        pivotPing.material.opacity = 0;
        return;
      }
      var eased = 1 - Math.pow(1 - t, 2);    // ease-out quad
      var s = startScale + (endScale - startScale) * eased;
      pivotPing.scale.set(s, s, s);
      pivotPing.material.opacity = startOpacity * (1 - t);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

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
    if (dx * dx + dy * dy > CLICK_MOVE_THRESHOLD_SQ) return;
    if (dtime > CLICK_TIME_THRESHOLD) return;
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
      if (ud.type === 'root-gem') {
        closeSidebar();    // close handler clears selection too
        resetView();
        return;
      }
      if (ud.building && ud.building.file) {
        if (ud.building.file.type === 'directory') {
          // Directory buildings aren't actually rendered (engine.js skips
          // them), but if the data ever shows up just open the sidebar.
          showDirSidebar(ud.building.file);
        } else {
          _setSelection({
            kind: 'file',
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

  // _setSelection(sel) — single entry point for changing what's selected.
  // sel is null OR { kind:'file', mesh, data, file } OR
  //                { kind:'directory', sidewalk, street, dir }.
  //
  // Computes the path-of-sidewalks (root → selection lineage), then
  // delegates ALL sidewalk colors to _refreshSidewalkTints(). No manual
  // tint bookkeeping — every street's color is derived from current state.
  function _setSelection(sel) {
    if (currentSelection && currentSelection.kind === 'file') {
      selectedOutline.visible = false;
    }
    currentSelection = sel;
    if (sel) {
      sel._pathSidewalks = _pathSidewalksForSelection(sel);
      if (sel.kind === 'file') {
        _syncOutlineToBuilding(selectedOutline, sel.mesh, sel.data);
        selectedOutline.visible = true;
      }
    }
    _refreshSidewalkTints();
    _updatePathLine();
  }

  // _setHover(h) — single entry point for hover. Independent of selection
  // (you can hover one thing while selecting another); coordinates via
  // _refreshSidewalkTints() which picks the right per-street tint.
  function _setHover(h) {
    if (currentHover && currentHover.kind === 'file') {
      hoverOutline.visible = false;
    }
    currentHover = h;
    if (h && h.kind === 'file' &&
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

  // Initial camera pose — captured here so the Controls panel's "Reset View"
  // button can return to it after the user has navigated away.
  var initialCamPos = camera.position.clone();
  var initialTarget = controls.target.clone();

  // Double-click + F dispatch by what's under the cursor:
  //   - building → frame the door face head-on
  //   - street   → square the street to screen-horizontal and zoom in for
  //                navigating it
  //   - empty    → recenter pivot to ground point (slide camera with delta)
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
    if (hits.length > 0) {
      var hit = hits[0];
      var ud  = hit.object.userData;
      if (ud.type === 'root-gem') {       // dblclick gem also resets view
        resetView();
        return;
      }
      if (ud.building && ud.building.file && ud.building.file.type === 'file') {
        _focusOnBuilding(hit.object, ud.building);
        return;
      }
      if (ud.street) {
        _focusOnStreet(ud.street, hit.point);
        return;
      }
      _recenterPivotToPoint(new THREE.Vector3(hit.point.x, 0, hit.point.z));
      return;
    }

    if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
      _recenterPivotToPoint(groundHit.clone());
    }
  }

  // _recenterPivotToPoint(p) — slide pivot to p; camera shifts by the same
  // delta so the visible scene doesn't zoom or rotate, just slides under.
  function _recenterPivotToPoint(p) {
    camera.up.set(0, 1, 0);
    var delta = p.clone().sub(controls.target);
    _animateCamera(p, camera.position.clone().add(delta), 350);
    _pingPivot(p);
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
    var doorDX = 0, doorDZ = 0, faceW;
    if      (b.orient === 's') { doorDZ =  1; faceW = b.w; }
    else if (b.orient === 'n') { doorDZ = -1; faceW = b.w; }
    else if (b.orient === 'e') { doorDX =  1; faceW = b.d; }
    else if (b.orient === 'w') { doorDX = -1; faceW = b.d; }
    else                       { doorDZ =  1; faceW = b.w; }
    var faceH = b.h;

    var halfV = (camera.fov * Math.PI / 180) / 2;
    var halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    var distForH = (faceH / 2) / Math.tan(halfV);
    var distForW = (faceW / 2) / Math.tan(halfH);
    var dist = Math.max(distForH, distForW) * 1.6 + 4;

    var halfDepth = (b.orient === 'e' || b.orient === 'w') ? b.w / 2 : b.d / 2;
    var newTarget = new THREE.Vector3(b.x, b.h / 2, b.y);

    // Try head-on first; raise camera 20° at a time if obstructed.
    var newCamPos = null;
    for (var attempt = 0; attempt < 5; attempt++) {
      var elev = (attempt * 20) * Math.PI / 180;
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

    _animateCamera(newTarget, newCamPos, 600);
    _pingPivot(newTarget);
  }

  // _isSightClear(camPos, target, focusedMesh) — does a ray from camPos to
  // target hit any building besides focusedMesh? Used by _focusOnBuilding
  // to pick a camera position with an unobstructed view.
  function _isSightClear(camPos, target, focusedMesh) {
    _xrayDir.subVectors(target, camPos).normalize();
    _xrayRay.set(camPos, _xrayDir);
    _xrayRay.far = camPos.distanceTo(target) - 0.5;
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

    var halfV = (camera.fov * Math.PI / 180) / 2;
    var halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    var distForLength = (s.length * 0.65 / 2) / Math.tan(halfH);
    var distForWidth  = (s.width * 4   / 2) / Math.tan(halfV);
    var altitude = Math.max(distForLength, distForWidth, maxBldgH * 1.4 + 50);

    // Near-90° elevation (87°) — well within OrbitControls' polar limit
    // (~88°) so the camera doesn't snap on the next update. Camera sits
    // at +offX / +offZ horizontal offset; with default world-up, screen-up
    // is the OPPOSITE direction (target's "far side" appears at top).
    var elev = 87 * Math.PI / 180;
    var horizDist = altitude / Math.tan(elev);

    var newCamPos = new THREE.Vector3(
      tx + offX * horizDist,
      altitude,
      tz + offZ * horizDist
    );
    _animateCamera(newTarget, newCamPos, 600);
    _pingPivot(newTarget);
  }

  function _animateCamera(newTarget, newCamPos, duration) {
    var token = ++camAnimToken;
    var startTarget = controls.target.clone();
    var startCamPos = camera.position.clone();
    var t0 = performance.now();

    function step() {
      if (camAnimToken !== token) return;       // superseded by a newer animation
      var elapsed = performance.now() - t0;
      var t = elapsed / duration;
      if (t >= 1) t = 1;
      var eased = 1 - Math.pow(1 - t, 3);       // ease-out cubic
      controls.target.lerpVectors(startTarget, newTarget, eased);
      camera.position.lerpVectors(startCamPos, newCamPos, eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function resetView() {
    camera.up.set(0, 1, 0);           // back to default world-up
    _animateCamera(initialTarget.clone(), initialCamPos.clone(), 500);
    _pingPivot(initialTarget);
  }

  // Hover pipeline: pointermove fires faster than render frames, so we
  // coalesce events into one raycast per rAF tick. The raycast result
  // then sits in a short commit-delay buffer — only after the cursor
  // hovers a target for HOVER_COMMIT_MS does the heavy cascade fade
  // engage. Brief brushes (mouse sweeping across the scene) never
  // commit, which keeps the city stable instead of strobing tiers.
  // Tooltip + cursor still update on every coalesced raycast for
  // responsiveness — only the fade-cascade is debounced.
  var HOVER_COMMIT_MS = CFG_HOVER_COMMIT_MS;
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
      if (ud.type === 'root-gem') {
        newHover = { kind: 'gem' };
        var rootName = (rootStreet && rootStreet.dir && rootStreet.dir.name) || 'root';
        tooltipText = 'root  ·  ' + rootName;
      } else if (ud.building && ud.building.file && ud.building.file.type === 'file') {
        var f = ud.building.file;
        newHover = { kind: 'file', mesh: h0.object, data: ud.building, file: f };
        tooltipText = f.name + (f.lines != null ? '  ·  ' + f.lines + ' lines' : '');
      } else if (ud.street && ud.street.dir) {
        var d = ud.street.dir;
        var n = (d.descendants_count != null) ? d.descendants_count : (d.children_count || 0);
        newHover = { kind: 'directory', sidewalk: h0.object, street: ud.street, dir: d };
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
    // the timer — only stable hovers (held > HOVER_COMMIT_MS) commit.
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
    }, HOVER_COMMIT_MS);
  }

  function _sameHover(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'file')      return a.mesh === b.mesh;
    if (a.kind === 'directory') return a.sidewalk === b.sidewalk;
    if (a.kind === 'gem')       return true;     // singleton
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
    } else if (e.key === 'f' || e.key === 'F') {
      // Focus pivot on whatever the cursor is currently pointing at — same
      // result as a double-click, but no need to release-press-press.
      _focusAtPointer(pointer.x, pointer.y);
    } else if (e.key === 'r' || e.key === 'R' || e.key === 'Home') {
      resetView();
    }
  });

  showLeftSidebar(manifest, {
    onResetView: resetView
  });

  // -- 8. Render loop --------------------------------------------------------
  var startTime = performance.now();
  var labelRight = new THREE.Vector3();
  // Reusable scratch objects for sight-line check + screen-space X-ray.
  var _xrayRay = new THREE.Raycaster();
  var _xrayDir = new THREE.Vector3();
  var _boxA    = new THREE.Box3();
  var _boxB    = new THREE.Box3();
  var _scratchCenter = new THREE.Vector3();
  var _corners = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
  ];

  // _projectBoxToNDC(box) -> { minX, maxX, minY, maxY }
  // Project all 8 corners of a world Box3 into NDC and return their
  // screen-aligned bounding rect. Used to test silhouette overlap.
  function _projectBoxToNDC(box) {
    _corners[0].set(box.min.x, box.min.y, box.min.z);
    _corners[1].set(box.max.x, box.min.y, box.min.z);
    _corners[2].set(box.min.x, box.max.y, box.min.z);
    _corners[3].set(box.max.x, box.max.y, box.min.z);
    _corners[4].set(box.min.x, box.min.y, box.max.z);
    _corners[5].set(box.max.x, box.min.y, box.max.z);
    _corners[6].set(box.min.x, box.max.y, box.max.z);
    _corners[7].set(box.max.x, box.max.y, box.max.z);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < 8; i++) {
      _corners[i].project(camera);
      if (_corners[i].x < minX) minX = _corners[i].x;
      if (_corners[i].x > maxX) maxX = _corners[i].x;
      if (_corners[i].y < minY) minY = _corners[i].y;
      if (_corners[i].y > maxY) maxY = _corners[i].y;
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

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
    var bldgTarget = (currentSelection && currentSelection.kind === 'file')
      ? currentSelection.mesh : null;
    var dirTarget = null;
    if (currentSelection) {
      if (currentSelection.kind === 'directory') {
        dirTarget = currentSelection.dir;
      } else if (currentSelection.kind === 'file') {
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
      if (currentHover.kind === 'directory' &&
          currentHover.street && currentHover.street.dir) {
        dirTarget = currentHover.street.dir;
      } else if (currentHover.kind === 'file' && currentHover.file) {
        var hoverParent = parentDirPath(currentHover.file.path);
        if (hoverParent != null) {
          var hoverStreet = streetsByDirPath[hoverParent];
          if (hoverStreet) dirTarget = hoverStreet.dir;
        }
      }
    }
    var hoverMesh  = (currentHover && currentHover.kind === 'file')
      ? currentHover.mesh : null;

    // Two faded tiers, both windowless (the GHOST_THRESHOLD below is set
    // high enough that any target < 1.0 swaps to the solid-color ghost,
    // dropping the windowed texture). NEAR keeps a clearly-visible body
    // for "1 step away"; FAR collapses to essentially just an outline.
    // Tier opacities + dim multipliers; sourced from config.scene.fade.
    var TIER_DIRECT      = 1.0;
    var TIER_DESC        = CFG_TIER_NEAR.main;
    var TIER_DESC_OUTLN  = CFG_TIER_NEAR.outline;
    var TIER_DESC_GHOST  = CFG_TIER_NEAR.ghost;
    var TIER_OTHER       = CFG_TIER_FAR.main;
    var TIER_OTHER_OUTLN = CFG_TIER_FAR.outline;
    var TIER_OTHER_GHOST = CFG_TIER_FAR.ghost;

    // Obstruction detection disabled for now — selected building relies
    // purely on the tiered fade. Re-enable by un-commenting and restoring
    // the obstructor-fade block in the per-building loop below.
    var obstructorIds = null;

    for (var bi = 0; bi < buildingMeshes.length; bi++) {
      var m = buildingMeshes[bi];
      if (m.userData.opacityCurrent == null) m.userData.opacityCurrent = 1.0;
      // Per-building visual tier. `target` drives main-mesh opacity;
      // `outlineDim` and `ghostDim` independently control the colored
      // outline + ghost-body so we can recede unrelated buildings hard
      // while keeping descendants readable.
      var target = 1.0;
      var outlineDim = 1.0;
      var ghostDim   = 1.0;
      if (m === bldgTarget) {
        // Selected file building: always full, never obstructor-faded.
        target = 1.0;
      } else if (dirTarget) {
        // Tiered fade by directory-tree distance from the building's
        // parent dir to the selected/hovered dir:
        //   0   → bright, full windows (the "neighborhood")
        //   1   → faded but textured (one hop along dir's spine —
        //          parent's other files OR direct subdir's files)
        //   ≥2  → outline-only ghost (cousins, deeper subtrees, etc.)
        var f = m.userData.building && m.userData.building.file;
        var dist = _dirTreeDistance(f, dirTarget);
        if (dist === 0) {
          target = TIER_DIRECT;
        } else if (dist === 1) {
          target     = TIER_DESC;
          outlineDim = TIER_DESC_OUTLN;
          ghostDim   = TIER_DESC_GHOST;
        } else {
          target     = TIER_OTHER;
          outlineDim = TIER_OTHER_OUTLN;
          ghostDim   = TIER_OTHER_GHOST;
        }
      }
      // Obstructor fade: when a building is selected, anything closer to
      // the camera that visually overlaps it gets EXTRA fade so the
      // selected building stays visible at any rotation/zoom. Applies on
      // top of the tier above (multiplies it down).
      if (bldgTarget && m !== bldgTarget && obstructorIds && obstructorIds[m.id]) {
        target     = Math.min(target, 0.10);
        outlineDim = Math.min(outlineDim, 0.20);
        ghostDim   = Math.min(ghostDim, 0.20);
      }
      // Hover restore: a hovered building never drops below 0.7.
      if (m === hoverMesh && target < 0.7) {
        target = 0.7;
        outlineDim = 1.0;
        ghostDim   = 1.0;
      }
      var cur = m.userData.opacityCurrent;
      if (cur !== target) {
        cur += (target - cur) * CFG_FADE_LERP;
        if (Math.abs(cur - target) < 0.005) cur = target;
        m.userData.opacityCurrent = cur;
      }

      // Crossfade band between the textured (windowed) mesh and the
      // windowless ghost body. The textured mesh ramps from invisible
      // (0) to FULLY OPAQUE (1.0) across the band, so windows appear
      // to fade in over the solid ghost backdrop instead of stalling
      // at a semi-transparent state. FADE_BOTTOM must stay above the
      // NEAR tier's target (TIER_DESC) so faded tiers never reveal
      // windows. FADE_TOP at 1.0 gives the widest window-fade ramp,
      // and smoothstep easing softens the start/end of the reveal so
      // it doesn't pop in.
      var FADE_TOP    = CFG_FADE_TOP;
      var FADE_BOTTOM = CFG_FADE_BOTTOM;
      var blend;   // 1.0 = textured wins, 0.0 = ghost wins
      if      (cur >= FADE_TOP)    blend = 1.0;
      else if (cur <= FADE_BOTTOM) blend = 0.0;
      else {
        var bRaw = (cur - FADE_BOTTOM) / (FADE_TOP - FADE_BOTTOM);
        blend = bRaw * bRaw * (3.0 - 2.0 * bRaw);   // smoothstep
      }

      var texturedAlpha = blend;                            // 0 → 1.0
      var ghostAlpha    = cur * ghostDim * (1.0 - blend);

      // Apply textured mesh opacity (per-material; multi-mat buildings
      // have one material per face). Material.transparent flag triggers
      // a shader recompile, so only flip it when it actually changed.
      var mats = Array.isArray(m.material) ? m.material : [m.material];
      var transparent = texturedAlpha < 0.999;
      for (var ki = 0; ki < mats.length; ki++) {
        var mat = mats[ki];
        if (mat.transparent !== transparent) {
          mat.transparent = transparent;
          mat.depthWrite  = !transparent;
          mat.needsUpdate = true;
        }
        mat.opacity = texturedAlpha;
      }
      m.visible = blend > 0.0;

      // Sync the colored outline + ghost body. Both share position/scale
      // with the main mesh (so they track height-mode toggle animations).
      //   outline.opacity = 1 − cur  (visible when building fades out)
      //   ghost crossfades in via (1 − blend), so the windowless body
      //   eases up as the windowed texture eases down.
      //
      // Outline + ghost dimming uses the per-building outlineDim/ghostDim
      // computed above (varies by tier so unrelated buildings recede much
      // harder than descendants).
      var b = m.userData.building;
      var outline = buildingOutlines[bi];
      if (outline) {
        outline.scale.set(b.w, b.h * (m.scale.y || 1), b.d);
        outline.position.copy(m.position);
        outline.material.opacity = (1.0 - cur) * outlineDim;
      }
      var ghost = buildingGhosts[bi];
      if (ghost) {
        ghost.scale.set(b.w, b.h * (m.scale.y || 1), b.d);
        ghost.position.copy(m.position);
        ghost.visible = blend < 1.0;
        ghost.material.opacity = ghostAlpha;
      }
    }

    // ---- 2. Outlines (sync + flowing rainbow color update) ----
    if (currentSelection && currentSelection.kind === 'file') {
      _syncOutlineToBuilding(selectedOutline, currentSelection.mesh, currentSelection.data);
      // Bottom (segments 0-3) and top (4-7) form continuous 4-edge loops
      // around the box. Each segment gets a START hue matching the previous
      // segment's END hue, so colors flow seamlessly around the loop. The
      // shared `t` advances every frame → entire spectrum chases around the
      // building. Vertical edges (8-11) take a single hue from their
      // corresponding bottom corner so the verticals colors-match the loop
      // they connect to.
      var t = performance.now() * 0.00045;
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
    if (currentHover && currentHover.kind === 'file' &&
        (!currentSelection || currentSelection.mesh !== currentHover.mesh)) {
      _syncOutlineToBuilding(hoverOutline, currentHover.mesh, currentHover.data);
    }
  }

  function animate() {
    controls.update();
    _updateXRayAndOutlines();
    _updatePathRainbow(performance.now() * 0.0006);
    _orientLabelsForCamera(streetLabels, camera, labelRight);
    if (rootGem) {
      var t = (performance.now() - startTime) / 1000;
      rootGem.rotation.y = t * 0.6;
      rootGem.position.y = rootGem.userData.baseY + Math.sin(t * 1.8) * rootGem.userData.bobAmp;
      // Scale-up affordance on hover so the gem reads as clickable.
      var gemTargetScale = (currentHover && currentHover.kind === 'gem') ? 1.25 : 1.0;
      var curS = rootGem.scale.x;
      var nextS = curS + (gemTargetScale - curS) * 0.18;
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

  // Hysteresis: only flip when the relevant axis crosses ±0.15, not 0.
  // Without this, near-top-down camera positions (where rightX/rightZ are
  // near zero) cause floating-point jitter from OrbitControls' damping to
  // flip labels back and forth every frame.
  var THRESH = 0.15;

  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i];
    var street = lbl.userData.street;
    var base = lbl.userData.baseRotY || 0;
    var axis  = (street.orientation === 'x') ? rightX : rightZ;
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
var _canvas = document.getElementById('city');
if (_canvas) {
  var manifest = readEmbeddedJson('codecity-manifest');
  var config   = readEmbeddedJson('codecity-config');
  startRenderLoop(_canvas, manifest, config);
}

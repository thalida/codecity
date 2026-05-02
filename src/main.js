// main.js — Entry point. Reads MANIFEST/CONFIG embedded in index.html,
// lays out the city, builds the scene, and starts the render loop with
// orbit/pan/zoom controls and raycast picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './styles.css';

import { buildCityScene } from './scene/engine.js';
import { layoutCity } from './scene/layout.js';
import { getBuildingColor, getDateRanges } from './scene/colors.js';
import { showFileSidebar, showDirSidebar, closeSidebar, setSidebarPalette } from './components/sidebar.js';
import { showTreeSidebar } from './components/tree.js';


function startRenderLoop(canvas, manifest, config) {
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
  var rootGem         = built.rootGem;
  var pickables = buildingMeshes.concat(streetPickables);
  var bbox = built.bbox;

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

  // Isometric framing from the -X/+Y/+Z octant — the root park sits at -X so
  // this places it in the foreground-left of the frame.
  var center = new THREE.Vector3();
  bbox.getCenter(center);
  var size = new THREE.Vector3();
  bbox.getSize(size);
  var radius = Math.max(size.x, size.z, size.y) * 0.5 + 10;
  var dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.4;
  var dir = new THREE.Vector3(-1, 1, 1).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.lookAt(center);

  // -- 5. Controls -------------------------------------------------------------
  var controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
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
    var hits = raycaster.intersectObjects(pickables, false);

    if (hits.length > 0) {
      var hit = hits[0].object.userData;
      if (hit.building && hit.building.file) {
        if (hit.building.file.type === 'directory') showDirSidebar(hit.building.file);
        else showFileSidebar(hit.building.file);
      } else if (hit.street && hit.street.dir) {
        showDirSidebar(hit.street.dir);
      } else {
        closeSidebar();
      }
    } else {
      closeSidebar();
    }
  }

  canvas.addEventListener('pointermove', function (e) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(pickables, false);
    canvas.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
  });

  // -- 7. Resize ---------------------------------------------------------------
  function onResize() {
    _resizeRendererToCanvas(renderer, canvas);
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    camera.aspect = cw / Math.max(1, ch);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  showTreeSidebar(manifest);

  // -- 8. Render loop --------------------------------------------------------
  var startTime = performance.now();
  var labelRight = new THREE.Vector3();
  function animate() {
    controls.update();
    _orientLabelsForCamera(streetLabels, camera, labelRight);
    if (rootGem) {
      var t = (performance.now() - startTime) / 1000;
      rootGem.rotation.y = t * 0.6;
      rootGem.position.y = rootGem.userData.baseY + Math.sin(t * 1.8) * rootGem.userData.bobAmp;
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

  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i];
    var street = lbl.userData.street;
    var base = lbl.userData.baseRotY || 0;
    var flip;
    if (street.orientation === 'x') {
      flip = (rightX < 0) ? Math.PI : 0;
    } else {
      flip = (rightZ < 0) ? Math.PI : 0;
    }
    lbl.rotation.y = base + flip;
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

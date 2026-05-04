// interaction/pathLineRenderer.js — owns the neon selection path line
// (gem → selected node, rainbow chasing) and the faded hover-preview
// path line (gem → hovered node).
//
// Subscribes to picker.selection / picker.hover and rebuilds the
// geometry whenever either changes. update(dtMs) ticks the rainbow
// color cycle on the selection line each frame. refreshMaterials() is
// called by applyTheme() to push PATH_LINE / HOVER_PATH_LINE config
// changes into the materials.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { PATH_LINE, HOVER_PATH_LINE, RAINBOW } from '../config/index.js';
import { NODE_KIND, RENDER_ORDERS } from '../constants.js';
import { computePathPoints } from '../scene/path.js';


export function createPathLineRenderer({ canvas, scene, cityScene, picker }) {
  // ── Selection path line (rainbow vertex colors) ────────────────────
  var _pl = PATH_LINE.get();
  var pathLineMat = new LineMaterial({
    vertexColors: true,
    linewidth:    _pl.LINEWIDTH,
    transparent:  true,
    opacity:      0.0,
    depthTest:    true,
    depthWrite:   false,
    worldUnits:   false,
  });
  pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  var pathLineGeo = new LineSegmentsGeometry();
  pathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  var pathLine = new LineSegments2(pathLineGeo, pathLineMat);
  pathLine.visible = false;
  pathLine.renderOrder = RENDER_ORDERS.PATH_LINE;
  scene.add(pathLine);

  var pathSegmentCount = 0;
  var _pathColorsBuf = new Float32Array(0);
  var _pathHsl = new THREE.Color();

  // ── Hover preview path line (single solid color, faded) ────────────
  var _hpl = HOVER_PATH_LINE.get();
  var hoverPathLineMat = new LineMaterial({
    color:       _hpl.COLOR,
    linewidth:   _hpl.LINEWIDTH,
    transparent: true,
    opacity:     0.0,
    depthTest:   true,
    depthWrite:  false,
    worldUnits:  false,
  });
  hoverPathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  var hoverPathLineGeo = new LineSegmentsGeometry();
  hoverPathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  var hoverPathLine = new LineSegments2(hoverPathLineGeo, hoverPathLineMat);
  hoverPathLine.visible = false;
  hoverPathLine.renderOrder = RENDER_ORDERS.PATH_LINE;
  scene.add(hoverPathLine);

  function _isHoverSameAsSelection() {
    var hov = picker.hover.get();
    var sel = picker.selection.get();
    if (!hov || !sel) return false;
    if (hov.kind !== sel.kind) return false;
    if (hov.kind === NODE_KIND.FILE)      return hov.mesh === sel.mesh;
    if (hov.kind === NODE_KIND.DIRECTORY) return hov.street === sel.street;
    if (hov.kind === NODE_KIND.GEM)       return true;
    return false;
  }

  function _updatePathLine() {
    var sel = picker.selection.get();
    var gemPos = cityScene.getGemWorldPos();
    if (!gemPos || !sel) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    var pts = computePathPoints(
      sel,
      { x: gemPos.x, z: gemPos.z },
      cityScene.getStreetsByDirMap(),
    );
    if (pts.length < 2) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    var elev = PATH_LINE.get().ELEVATION;
    var flat = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    // Recreate the geometry on every update — LineSegmentsGeometry's
    // setPositions can leave stale instance state when segment count
    // changes (segments silently dropped otherwise).
    if (pathLineGeo && pathLineGeo.dispose) pathLineGeo.dispose();
    pathLineGeo = new LineSegmentsGeometry();
    pathLineGeo.setPositions(flat);
    pathLine.geometry = pathLineGeo;

    pathSegmentCount = pts.length - 1;
    if (_pathColorsBuf.length !== pathSegmentCount * 6) {
      _pathColorsBuf = new Float32Array(pathSegmentCount * 6);
    }
    pathLineMat.opacity = PATH_LINE.get().OPACITY;
    pathLine.visible = true;
  }

  function _updateHoverPathLine() {
    var hov = picker.hover.get();
    var gemPos = cityScene.getGemWorldPos();
    var cfg = HOVER_PATH_LINE.get();
    function hide() { hoverPathLine.visible = false; hoverPathLineMat.opacity = 0; }
    if (!cfg.ENABLED || !gemPos || !hov)            return hide();
    if (hov.kind === NODE_KIND.GEM)                 return hide();
    if (_isHoverSameAsSelection())                  return hide();
    var pts = computePathPoints(
      hov,
      { x: gemPos.x, z: gemPos.z },
      cityScene.getStreetsByDirMap(),
    );
    if (pts.length < 2) return hide();
    var elev = cfg.ELEVATION;
    var flat = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    if (hoverPathLineGeo && hoverPathLineGeo.dispose) hoverPathLineGeo.dispose();
    hoverPathLineGeo = new LineSegmentsGeometry();
    hoverPathLineGeo.setPositions(flat);
    hoverPathLine.geometry = hoverPathLineGeo;
    hoverPathLineMat.opacity = cfg.OPACITY;
    hoverPathLine.visible = true;
  }

  // Reactive: rebuild geometry on selection / hover / cityScene change.
  picker.selection.subscribe(function () { _updatePathLine(); _updateHoverPathLine(); });
  picker.hover.subscribe(function ()     { _updateHoverPathLine(); });
  cityScene.onChange(function ()         { _updatePathLine(); _updateHoverPathLine(); });

  // ── Per-frame: rainbow chase on the selection line ─────────────────
  function update(_dtMs) {
    if (pathSegmentCount <= 0 || !pathLine.visible) return;
    var rb = RAINBOW.get();
    var t = performance.now() * rb.SPEED;
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

  function refreshMaterials() {
    var pl = PATH_LINE.get();
    pathLineMat.linewidth = pl.LINEWIDTH;
    if (pathLine.visible) pathLineMat.opacity = pl.OPACITY;
    var hpl = HOVER_PATH_LINE.get();
    hoverPathLineMat.color.set(hpl.COLOR);
    hoverPathLineMat.linewidth = hpl.LINEWIDTH;
    _updateHoverPathLine();
  }

  function onResize() {
    pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
    hoverPathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  }

  function dispose() {
    if (pathLine.parent) pathLine.parent.remove(pathLine);
    if (hoverPathLine.parent) hoverPathLine.parent.remove(hoverPathLine);
    if (pathLineGeo && pathLineGeo.dispose) pathLineGeo.dispose();
    if (hoverPathLineGeo && hoverPathLineGeo.dispose) hoverPathLineGeo.dispose();
    if (pathLineMat.dispose) pathLineMat.dispose();
    if (hoverPathLineMat.dispose) hoverPathLineMat.dispose();
  }

  return {
    update: update,
    refreshMaterials: refreshMaterials,
    onResize: onResize,
    dispose: dispose,
  };
}

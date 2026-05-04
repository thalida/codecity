// interaction/inputHandlers.js — pointer / dblclick / keydown / resize
// wiring. Translates DOM events into picker and cameraRig calls.
//
// Public contract:
//   const handlers = createInputHandlers({
//     canvas, picker, rig, renderer, camera,
//     onResize: function () { /* renderer-specific onResize work */ },
//     showTooltip, hideTooltip,            // tooltip api (from components/tooltip.js)
//   });
//   handlers.dispose();

import * as THREE from 'three';
import { INPUT_TIMING } from '../config/index.js';
import { NODE_KIND } from '../constants.js';


export function createInputHandlers({
  canvas, picker, rig,
  renderer, camera, scene,
  showTooltip, hideTooltip,
  onResize,
}) {
  // Click vs. drag: pointerdown→pointerup with movement + time threshold.
  var downX = 0, downY = 0, downTime = 0;

  // Hover pipeline: pointermove fires faster than render frames, so
  // coalesce events into one raycast per rAF tick. Result sits in a
  // short commit-delay buffer so brief brushes don't engage the heavy
  // cascade fade (the buildingFader's tier change). Tooltip + cursor
  // update on every coalesced raycast for responsiveness — only the
  // hover commit is debounced.
  var _hoverRafId    = 0;
  var _hoverLastEvt  = null;
  var _hoverPending  = null;
  var _hoverCommitId = 0;

  function _tooltipForHover(target) {
    if (!target) return null;
    if (target.kind === NODE_KIND.GEM) {
      // Resolve via picker → cityScene only as needed; we don't keep a
      // direct cityScene ref here.
      return 'root';
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
    if (a.kind === NODE_KIND.GEM)       return true;
    return false;
  }

  function _processHoverRaf() {
    _hoverRafId = 0;
    var e = _hoverLastEvt;
    if (!e) return;
    var hit = picker.pickAt(e.clientX, e.clientY);
    var newHover = picker.interpretHit(hit);
    // Filter: directory-shaped targets that came from a stray "directory
    // building" (engine.js typically skips these) don't have a sidewalk
    // — treat as no hover.
    if (newHover && newHover.kind === NODE_KIND.DIRECTORY && !newHover.sidewalk) {
      newHover = null;
    }
    var tooltipText = _tooltipForHover(newHover);

    if (tooltipText) {
      showTooltip(tooltipText, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      hideTooltip();
      canvas.style.cursor = 'grab';
    }

    if (_sameHover(newHover, picker.hover.get())) {
      if (_hoverCommitId) { clearTimeout(_hoverCommitId); _hoverCommitId = 0; }
      _hoverPending = null;
      return;
    }
    if (_hoverCommitId && _sameHover(newHover, _hoverPending)) return;
    _hoverPending = newHover;
    if (_hoverCommitId) clearTimeout(_hoverCommitId);
    _hoverCommitId = setTimeout(function () {
      _hoverCommitId = 0;
      var toCommit = _hoverPending;
      _hoverPending = null;
      if (!_sameHover(toCommit, picker.hover.get())) picker.setHover(toCommit);
    }, INPUT_TIMING.get().HOVER_COMMIT_MS);
  }

  function _handlePick(clientX, clientY) {
    var hit = picker.pickAt(clientX, clientY);
    if (!hit) {
      picker.setSelection(null);
      return;
    }
    if (hit.object.userData.type === NODE_KIND.GEM) {
      picker.setSelection(null);
      rig.reset();
      return;
    }
    picker.setSelection(picker.interpretHit(hit));
  }

  function _focusAtPointer(clientX, clientY) {
    var hit = picker.pickAt(clientX, clientY);
    if (!hit) return;
    var ud = hit.object.userData;
    if (ud.type === NODE_KIND.GEM) {
      rig.reset();
      return;
    }
    if (ud.building && ud.building.file && ud.building.file.type === NODE_KIND.FILE) {
      rig.focusBuilding(hit.object, ud.building);
      return;
    }
    if (ud.street) {
      rig.focusStreet(ud.street, hit.point);
      return;
    }
    rig.recenterTo(new THREE.Vector3(hit.point.x, 0, hit.point.z));
  }

  // ── Bindings ───────────────────────────────────────────────────────
  var _disposers = [];
  function _on(target, event, fn) {
    target.addEventListener(event, fn);
    _disposers.push(function () { target.removeEventListener(event, fn); });
  }

  _on(canvas, 'pointerdown', function (e) {
    downX = e.clientX; downY = e.clientY; downTime = Date.now();
  });

  _on(canvas, 'pointerup', function (e) {
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

  _on(canvas, 'pointermove', function (e) {
    _hoverLastEvt = e;
    if (_hoverRafId) return;
    _hoverRafId = requestAnimationFrame(_processHoverRaf);
  });

  _on(canvas, 'pointerleave', function () {
    hideTooltip();
    if (_hoverRafId)    { cancelAnimationFrame(_hoverRafId); _hoverRafId = 0; }
    if (_hoverCommitId) { clearTimeout(_hoverCommitId);      _hoverCommitId = 0; }
    _hoverPending = null;
    picker.setHover(null);
  });

  _on(canvas, 'dblclick', function (e) {
    _focusAtPointer(e.clientX, e.clientY);
  });

  _on(document, 'keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

    if (e.key === 'Escape') {
      picker.setSelection(null);
      picker.setHover(null);
    } else if (e.key === 'r' || e.key === 'R' || e.key === 'Home') {
      rig.reset();
    } else if (e.key === 'f' || e.key === 'F') {
      var sel = picker.selection.get();
      if (!sel) return;
      if (sel.kind === NODE_KIND.FILE) {
        rig.focusBuilding(sel.mesh, sel.data);
      } else if (sel.kind === NODE_KIND.DIRECTORY) {
        rig.focusStreet(sel.street);
      }
    }
  });

  function _resize() {
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / Math.max(1, ch);
    camera.updateProjectionMatrix();
    if (typeof onResize === 'function') onResize();
    // Paint the resized canvas synchronously so the browser doesn't
    // show a blank/cleared frame between resize and the next animate().
    renderer.render(scene, camera);
  }
  _on(window, 'resize', _resize);

  // Sidebars share horizontal space via flexbox — opening / closing
  // them changes canvas size without firing window resize, so observe
  // the canvas itself.
  var _resizeObs = null;
  if (typeof ResizeObserver !== 'undefined') {
    _resizeObs = new ResizeObserver(_resize);
    _resizeObs.observe(canvas);
    _disposers.push(function () { _resizeObs.disconnect(); });
  }

  function dispose() {
    for (var i = 0; i < _disposers.length; i++) {
      try { _disposers[i](); } catch (_) { /* noop */ }
    }
    _disposers = [];
    if (_hoverRafId)    cancelAnimationFrame(_hoverRafId);
    if (_hoverCommitId) clearTimeout(_hoverCommitId);
  }

  return { dispose: dispose };
}

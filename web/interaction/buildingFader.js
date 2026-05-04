// interaction/buildingFader.js — per-frame opacity tier logic for the
// per-building body. Decides which fade tier each building belongs to
// based on selection/hover state, lerps three opacity layers
// (body / ghost / outline) toward the tier's targets, and applies
// body opacity directly to mesh.material.opacity (+ transparent flag).
//
// The ghost and outline targets are stashed on mesh.userData so the
// outlineRenderer module can read them without re-running the tier
// logic. Field ownership:
//
//   buildingFader     → mesh.material.opacity, mat.transparent, mat.depthWrite
//   outlineRenderer   → ghost.material.opacity, outlineMat.opacity, hover/selected outline transforms
//
// The `userData.{bodyOp, ghostOp, outlineOp}` fields are intermediate
// state owned by buildingFader; outlineRenderer reads them as inputs.

import { BUILDING_FADE } from '../config/index.js';
import { NODE_KIND } from '../constants.js';
import { parentDirPath } from '../scene/path.js';

// material.opacity ≥ this counts as fully opaque (depthWrite on, full alpha).
// Just below 1.0 so any faded tier flips to true transparency.
var OPAQUE_THRESHOLD = 0.999;


function _stepOpacity(cur, target, cfg) {
  if (cur === target) return cur;
  var next = cur + (target - cur) * cfg.LERP_SPEED;
  if (Math.abs(next - target) < cfg.SNAP_THRESHOLD) next = target;
  return next;
}


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


export function createBuildingFader({ cityScene, picker }) {

  function _resolveDirTarget(sel, hov) {
    var dirTarget = null;
    if (sel) {
      if (sel.kind === NODE_KIND.DIRECTORY) {
        dirTarget = sel.dir;
      } else if (sel.kind === NODE_KIND.FILE) {
        var pp = parentDirPath(sel.file.path);
        if (pp != null) {
          var ps = cityScene.getStreetByDir(pp);
          if (ps) dirTarget = ps.dir;
        }
      }
    }
    if (hov) {
      if (hov.kind === NODE_KIND.DIRECTORY && hov.street && hov.street.dir) {
        dirTarget = hov.street.dir;
      } else if (hov.kind === NODE_KIND.FILE && hov.file) {
        var hp = parentDirPath(hov.file.path);
        if (hp != null) {
          var hs = cityScene.getStreetByDir(hp);
          if (hs) dirTarget = hs.dir;
        }
      }
    }
    return dirTarget;
  }

  function update(_dtMs) {
    var sel = picker.selection.get();
    var hov = picker.hover.get();

    var bldgTarget = (sel && sel.kind === NODE_KIND.FILE) ? sel.mesh : null;
    var dirTarget  = _resolveDirTarget(sel, hov);
    var hoverMesh  = (hov && hov.kind === NODE_KIND.FILE) ? hov.mesh : null;

    var fadeCfg = BUILDING_FADE.get();
    var buildings = cityScene.getBuildings();

    for (var bi = 0; bi < buildings.length; bi++) {
      var m = buildings[bi];

      // Init per-layer lerp state. Each layer animates toward its
      // tier-derived target independently.
      if (m.userData.bodyOp    == null) m.userData.bodyOp    = 1.0;
      if (m.userData.ghostOp   == null) m.userData.ghostOp   = 0.0;
      if (m.userData.outlineOp == null) m.userData.outlineOp = 0.0;

      // Tier decision.
      var detail, outlineOn, bodyOpacity, outlineOpacity;
      if (m === bldgTarget) {
        detail = 'full';      outlineOn = false;
        bodyOpacity = 1.0;    outlineOpacity = 0;
      } else if (dirTarget) {
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
        detail         = fadeCfg.DEFAULT_DETAIL;
        outlineOn      = fadeCfg.DEFAULT_OUTLINE;
        bodyOpacity    = fadeCfg.DEFAULT_BODY_OPACITY;
        outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
      }

      // Hover preview: a hovered file building always renders as DEFAULT.
      if (m === hoverMesh) {
        detail         = fadeCfg.DEFAULT_DETAIL;
        outlineOn      = fadeCfg.DEFAULT_OUTLINE;
        bodyOpacity    = fadeCfg.DEFAULT_BODY_OPACITY;
        outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
      }

      // Translate (detail, outline, opacities) → per-layer targets.
      var bodyTarget    = (detail === 'full')       ? bodyOpacity    : 0;
      var ghostTarget   = (detail === 'silhouette') ? bodyOpacity    : 0;
      var outlineTarget = outlineOn                 ? outlineOpacity : 0;

      m.userData.bodyOp    = _stepOpacity(m.userData.bodyOp,    bodyTarget,    fadeCfg);
      m.userData.ghostOp   = _stepOpacity(m.userData.ghostOp,   ghostTarget,   fadeCfg);
      m.userData.outlineOp = _stepOpacity(m.userData.outlineOp, outlineTarget, fadeCfg);

      // Apply body opacity. material.transparent flip triggers a shader
      // recompile, so only flip when it actually changed.
      var bodyOp = m.userData.bodyOp;
      var mats = Array.isArray(m.material) ? m.material : [m.material];
      var bodyTransparent = bodyOp < OPAQUE_THRESHOLD;
      for (var ki = 0; ki < mats.length; ki++) {
        var mat = mats[ki];
        if (!mat) continue;
        if (mat.transparent !== bodyTransparent) {
          mat.transparent = bodyTransparent;
          mat.depthWrite  = !bodyTransparent;
          mat.needsUpdate = true;
        }
        mat.opacity = bodyOp;
      }
      m.visible = bodyOp > 0;
    }
  }

  return { update: update };
}

// scene/cityScene.js — owns the persistent THREE.Scene plus every
// manifest-bound mesh (buildings, streets, labels, paths, asphalt, root
// gem) and the lookup maps consumers use to reach them by path.
//
// Public contract:
//
//   const cityScene = createCityScene(canvas);
//   cityScene.applyManifest(manifest);    // builds OR rebuilds in-place
//
//   cityScene.scene                       // THREE.Scene reference
//   cityScene.getBuildings(), .getStreetPickables(), …
//   cityScene.getBuildingByPath(p), .getSidewalkByDir(p), …
//
//   cityScene.onBeforeChange(cb)          // before disposal
//   cityScene.onChange(cb)                // after rebuild, with diff
//   cityScene.disposeMesh(mesh)           // animator's onComplete calls this
//
// applyManifest computes the entering / exiting / staying buckets vs the
// previous manifest (matched by file.path / dir.path) and fires onChange
// with them. Phase 1 emits the diff but no consumer reads it yet — the
// animator (commit 9) is what wires entry/exit tweens to those buckets.
//
// Disposal: every mesh that was added by buildCityScene OR by this
// module's outline/ghost build gets removed from the persistent scene
// and disposed. The disposer walks geometry → materials → any property
// whose value is a THREE.Texture, so new mesh shapes don't need
// special-casing. disposeMesh() is idempotent (userData.disposed flag)
// so a double-dispose during a rapid edit can't trip a Three.js error.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { layoutCity } from './layout.js';
import { buildCityScene } from './engine.js';
import { getBuildingColor, getDateRanges } from './colors.js';
import { parentDirPath } from './path.js';
import { BUILDING_PALETTE, SCENE_COLORS, BUILDING_OUTLINE } from '../config/index.js';
import { NODE_KIND, STREET_AXIS, RENDER_ORDERS } from '../constants.js';

// 12 edges of a unit cube as flat [x,y,z, x,y,z, ...] segment endpoints.
// Used by Line2 outlines (rendered as triangle strips so linewidth is
// settable in pixels — regular WebGL lines are locked to 1px). Exported
// so the hover/selected outline meshes in main.js (and later in
// outlineRenderer.js) share this geometry definition.
export const UNIT_BOX_EDGE_POSITIONS = [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5,
  -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
  0.5,
];

export function createCityScene(canvas) {
  // Persistent across applyManifest calls.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

  // Shared box geometry for ghost meshes — one geometry, many meshes.
  // Lives across rebuilds; the per-mesh transform sets each ghost's
  // size/position. Disposed only when the whole cityScene is disposed.
  const _ghostBoxGeo = new THREE.BoxGeometry(1, 1, 1);

  // Manifest-bound state. Reassigned on each applyManifest.
  let manifest = null;
  let layout = null;
  let dateRanges = null;
  let bbox = null;
  let rootStreet = null;
  let gemWorldPos = null;

  let buildingMeshes = [];
  let streetPickables = [];
  let streetLabels = [];
  let pathMeshes = [];
  let asphaltMeshes = [];
  let rootGem = null;
  let rootGemBody = null;
  let rootGemEdges = null;

  let buildingOutlines = [];
  let buildingOutlineMats = [];
  let buildingGhosts = [];

  let sidewalksByDirPath = {};
  let streetsByDirPath = {};
  let buildingsByPath = {};
  let pathMeshesByDirPath = {};

  // Listeners
  const beforeChangeCbs = [];
  const changeCbs = [];

  function _emit(arr, payload) {
    // Snapshot to allow listeners to unsubscribe themselves mid-emit
    // without disturbing iteration.
    const snap = arr.slice();
    for (let i = 0; i < snap.length; i++) {
      try {
        snap[i](payload);
      } catch (e) {
        console.error('[cityScene] listener error', e);
      }
    }
  }

  function onBeforeChange(cb) {
    beforeChangeCbs.push(cb);
    return function unsubscribe() {
      const idx = beforeChangeCbs.indexOf(cb);
      if (idx >= 0) beforeChangeCbs.splice(idx, 1);
    };
  }

  function onChange(cb) {
    changeCbs.push(cb);
    return function unsubscribe() {
      const idx = changeCbs.indexOf(cb);
      if (idx >= 0) changeCbs.splice(idx, 1);
    };
  }

  // Generic three.js disposer. Walks geometry → materials → any own
  // property of each material whose value is a THREE.Texture. Idempotent
  // via userData.disposed.
  function _disposeObject(obj) {
    if (!obj || (obj.userData && obj.userData.disposed)) return;
    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
      // Dispose any texture attached to this material.
      for (const key in m) {
        if (!Object.prototype.hasOwnProperty.call(m, key)) continue;
        const v = m[key];
        if (v && v.isTexture && typeof v.dispose === 'function') v.dispose();
      }
      if (typeof m.dispose === 'function') m.dispose();
    }
    if (obj.userData) obj.userData.disposed = true;
  }

  function _removeAndDispose(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    _disposeObject(obj);
  }

  // Public idempotent disposal — animator's onComplete calls this when
  // an exit-tween finishes. A second call on the same mesh no-ops.
  function disposeMesh(mesh) {
    if (!mesh || (mesh.userData && mesh.userData.disposed)) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    // For a building mesh, also dispose its paired outline + ghost so
    // we don't leave silhouettes hanging around the scene.
    const paired = (mesh.userData && mesh.userData.paired) || null;
    if (paired) {
      if (paired.outline) _removeAndDispose(paired.outline);
      if (paired.ghost) _removeAndDispose(paired.ghost);
    }
    _disposeObject(mesh);
  }

  function _disposeAllManifestState() {
    // Drop refs to outline/ghost from each building's userData first so
    // the per-mesh "paired" pointers don't outlive their targets.
    for (let i = 0; i < buildingMeshes.length; i++) {
      if (buildingMeshes[i].userData) buildingMeshes[i].userData.paired = null;
    }
    for (let bi = 0; bi < buildingMeshes.length; bi++) _removeAndDispose(buildingMeshes[bi]);
    for (let si = 0; si < streetPickables.length; si++) _removeAndDispose(streetPickables[si]);
    for (let li = 0; li < streetLabels.length; li++) _removeAndDispose(streetLabels[li]);
    for (let pi = 0; pi < pathMeshes.length; pi++) _removeAndDispose(pathMeshes[pi]);
    for (let ai = 0; ai < asphaltMeshes.length; ai++) _removeAndDispose(asphaltMeshes[ai]);
    for (let oi = 0; oi < buildingOutlines.length; oi++) _removeAndDispose(buildingOutlines[oi]);
    for (let gi = 0; gi < buildingGhosts.length; gi++) _removeAndDispose(buildingGhosts[gi]);
    if (rootGem) {
      if (rootGem.parent) rootGem.parent.remove(rootGem);
      rootGem.traverse(_disposeObject);
    }
  }

  function _buildOutlinesAndGhosts() {
    buildingOutlines = [];
    buildingOutlineMats = [];
    buildingGhosts = [];
    const lineWidth = BUILDING_OUTLINE.get().WIDTH;

    for (let bi = 0; bi < buildingMeshes.length; bi++) {
      const bm = buildingMeshes[bi];
      const bd = bm.userData.building;
      const bcol = new THREE.Color(bd.color);

      const olGeo = new LineSegmentsGeometry();
      olGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
      const olMat = new LineMaterial({
        color: bcol.clone(),
        linewidth: lineWidth,
        transparent: true,
        opacity: 0.0,
        depthTest: true,
        depthWrite: false,
        worldUnits: false,
      });
      olMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
      const ol = new LineSegments2(olGeo, olMat);
      ol.renderOrder = RENDER_ORDERS.BUILDING_OUTLINE;
      ol.scale.set(bd.w, bd.h * (bm.scale.y || 1), bd.d);
      ol.position.copy(bm.position);
      scene.add(ol);
      buildingOutlines.push(ol);
      buildingOutlineMats.push(olMat);

      const gh = new THREE.Mesh(
        _ghostBoxGeo,
        new THREE.MeshBasicMaterial({
          color: bcol.clone(),
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
        })
      );
      gh.visible = false;
      gh.scale.set(bd.w, bd.h * (bm.scale.y || 1), bd.d);
      gh.position.copy(bm.position);
      scene.add(gh);
      buildingGhosts.push(gh);

      // Link outline + ghost back to the building so disposeMesh can
      // dispose them as a set when the animator retires the building.
      bm.userData.paired = { outline: ol, ghost: gh, mat: olMat };
    }
  }

  function _buildLookups() {
    sidewalksByDirPath = {};
    streetsByDirPath = {};
    for (let spi = 0; spi < streetPickables.length; spi++) {
      const sw = streetPickables[spi];
      const swStreet = sw.userData.street;
      const swDir = swStreet && swStreet.dir;
      if (swDir && swDir.path != null) {
        sidewalksByDirPath[swDir.path] = sw;
        streetsByDirPath[swDir.path] = swStreet;
      }
    }

    buildingsByPath = {};
    for (let bpi = 0; bpi < buildingMeshes.length; bpi++) {
      const bm = buildingMeshes[bpi];
      const bd = bm.userData.building;
      if (bd && bd.file && bd.file.path != null) {
        buildingsByPath[bd.file.path] = { mesh: bm, building: bd };
      }
    }

    pathMeshesByDirPath = {};
    for (let pmi = 0; pmi < pathMeshes.length; pmi++) {
      const pm = pathMeshes[pmi];
      const pmFile = pm.userData.file;
      const pmDir = pmFile && pmFile.path != null ? parentDirPath(pmFile.path) : null;
      if (pmDir == null) continue;
      if (!pathMeshesByDirPath[pmDir]) pathMeshesByDirPath[pmDir] = [];
      pathMeshesByDirPath[pmDir].push(pm);
    }
  }

  function _computeRootStreetAndGem() {
    rootStreet =
      ((layout && layout.streets) || []).filter(function (s) {
        return s.isRoot;
      })[0] || null;
    if (!rootStreet) {
      gemWorldPos = null;
      return;
    }
    gemWorldPos = new THREE.Vector3();
    if (rootStreet.orientation === STREET_AXIS.X) {
      gemWorldPos.set(rootStreet.x - rootStreet.length / 2 + rootStreet.width / 2, 0, rootStreet.y);
    } else {
      gemWorldPos.set(rootStreet.x, 0, rootStreet.y - rootStreet.length / 2 + rootStreet.width / 2);
    }
  }

  // Diff against the prior manifest state (already-stale arrays just
  // before disposal) using the stable identity {file.path, dir.path,
  // file.path} for buildings/streets/paths. Phase-1 callers may ignore;
  // animator (commit 9) consumes this to drive entry/exit tweens.
  function _computeDiff(prev) {
    const prevBuildings = {};
    for (let i = 0; i < (prev.buildings || []).length; i++) {
      const bm = prev.buildings[i];
      const fp =
        bm.userData.building && bm.userData.building.file && bm.userData.building.file.path;
      if (fp != null) prevBuildings[fp] = bm;
    }
    const prevStreets = {};
    for (let s = 0; s < (prev.streetPickables || []).length; s++) {
      const sw = prev.streetPickables[s];
      const dp = sw.userData.street && sw.userData.street.dir && sw.userData.street.dir.path;
      if (dp != null) prevStreets[dp] = sw;
    }

    const entering = { buildings: [], streets: [] };
    const exiting = { buildings: [], streets: [] };
    const staying = { buildings: [], streets: [] };

    for (let bi = 0; bi < buildingMeshes.length; bi++) {
      const nbm = buildingMeshes[bi];
      const nfp =
        nbm.userData.building && nbm.userData.building.file && nbm.userData.building.file.path;
      if (nfp == null) continue;
      if (Object.prototype.hasOwnProperty.call(prevBuildings, nfp)) {
        staying.buildings.push({ oldMesh: prevBuildings[nfp], newMesh: nbm });
        delete prevBuildings[nfp];
      } else {
        entering.buildings.push({ mesh: nbm });
      }
    }
    for (const ek in prevBuildings) {
      if (Object.prototype.hasOwnProperty.call(prevBuildings, ek)) {
        exiting.buildings.push({ mesh: prevBuildings[ek] });
      }
    }

    for (let sj = 0; sj < streetPickables.length; sj++) {
      const nsw = streetPickables[sj];
      const ndp = nsw.userData.street && nsw.userData.street.dir && nsw.userData.street.dir.path;
      if (ndp == null) continue;
      if (Object.prototype.hasOwnProperty.call(prevStreets, ndp)) {
        staying.streets.push({ oldMesh: prevStreets[ndp], newMesh: nsw });
        delete prevStreets[ndp];
      } else {
        entering.streets.push({ mesh: nsw });
      }
    }
    for (const sk in prevStreets) {
      if (Object.prototype.hasOwnProperty.call(prevStreets, sk)) {
        exiting.streets.push({ mesh: prevStreets[sk] });
      }
    }

    return { entering: entering, exiting: exiting, staying: staying };
  }

  function applyManifest(newManifest) {
    const prev = {
      buildings: buildingMeshes,
      streetPickables: streetPickables,
      streetLabels: streetLabels,
      pathMeshes: pathMeshes,
      asphaltMeshes: asphaltMeshes,
      rootGem: rootGem,
      manifest: manifest,
      layout: layout,
    };

    _emit(beforeChangeCbs, prev);

    // Capture old building transforms BEFORE disposal so the animator
    // can tween "staying" meshes from their old position to the new
    // one without a snap. Keyed by file.path — stable across rebuilds.
    const prevBuildingTransforms = {};
    for (let pi = 0; pi < buildingMeshes.length; pi++) {
      const pm = buildingMeshes[pi];
      const pf = pm.userData.building && pm.userData.building.file;
      if (pf && pf.path != null) {
        prevBuildingTransforms[pf.path] = {
          position: pm.position.clone(),
          scaleY: pm.scale.y,
        };
      }
    }

    _disposeAllManifestState();

    manifest = newManifest;
    layout = layoutCity(manifest.tree);
    dateRanges = getDateRanges(manifest.tree);

    // Color buildings before mesh creation — buildCityScene reads b.color.
    const dirColor = BUILDING_PALETTE.get().DIRECTORY_COLOR;
    const buildings = (layout && layout.buildings) || [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.file && b.file.type === NODE_KIND.FILE) {
        b.color = getBuildingColor(b.file, dateRanges);
      } else {
        b.color = dirColor;
      }
    }

    const built = buildCityScene(layout);
    bbox = built.bbox;
    buildingMeshes = built.buildingMeshes || [];
    streetPickables = built.streetPickables || [];
    streetLabels = built.streetLabels || [];
    pathMeshes = built.pathMeshes || [];
    asphaltMeshes = built.asphaltMeshes || [];
    rootGem = built.rootGem || null;
    rootGemBody = built.rootGemBody || null;
    rootGemEdges = built.rootGemEdges || null;

    // Migrate built scene's children into the persistent scene. Iterate
    // a copy because re-parenting to scene mutates built.scene.children.
    const newKids = built.scene.children.slice();
    for (let k = 0; k < newKids.length; k++) scene.add(newKids[k]);
    // buildCityScene also set its own scene.background; mirror onto ours.
    scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

    // Stamp the gem body so it can participate in raycast picking.
    if (rootGem) {
      const gemBody = rootGem.children && rootGem.children[0];
      if (gemBody) gemBody.userData.type = NODE_KIND.GEM;
    }

    _buildOutlinesAndGhosts();
    _buildLookups();
    _computeRootStreetAndGem();

    const diff = _computeDiff(prev);
    // Attach transform snapshots so the animator can tween from the
    // previous mesh's resting place. For entering meshes, no prev
    // exists, so just expose the target. For staying, both.
    for (let ei = 0; ei < diff.entering.buildings.length; ei++) {
      const em = diff.entering.buildings[ei].mesh;
      diff.entering.buildings[ei].newPosition = em.position.clone();
      diff.entering.buildings[ei].newScaleY = em.scale.y;
    }
    for (let si = 0; si < diff.staying.buildings.length; si++) {
      const nm = diff.staying.buildings[si].newMesh;
      const fp =
        nm.userData.building && nm.userData.building.file && nm.userData.building.file.path;
      const oldT = fp != null ? prevBuildingTransforms[fp] : null;
      if (oldT) {
        diff.staying.buildings[si].oldPosition = oldT.position;
        diff.staying.buildings[si].oldScaleY = oldT.scaleY;
      }
      diff.staying.buildings[si].newPosition = nm.position.clone();
      diff.staying.buildings[si].newScaleY = nm.scale.y;
    }

    _emit(changeCbs, diff);
  }

  function dispose() {
    _disposeAllManifestState();
    if (_ghostBoxGeo && _ghostBoxGeo.dispose) _ghostBoxGeo.dispose();
    beforeChangeCbs.length = 0;
    changeCbs.length = 0;
  }

  return {
    scene: scene,
    applyManifest: applyManifest,
    dispose: dispose,
    onBeforeChange: onBeforeChange,
    onChange: onChange,
    disposeMesh: disposeMesh,

    getManifest: function () {
      return manifest;
    },
    getLayout: function () {
      return layout;
    },
    getBbox: function () {
      return bbox;
    },
    getRoot: function () {
      return manifest && manifest.tree;
    },
    getDateRanges: function () {
      return dateRanges;
    },
    getBuildings: function () {
      return buildingMeshes;
    },
    getStreetPickables: function () {
      return streetPickables;
    },
    getStreetLabels: function () {
      return streetLabels;
    },
    getPathMeshes: function () {
      return pathMeshes;
    },
    getAsphaltMeshes: function () {
      return asphaltMeshes;
    },
    getRootGem: function () {
      return rootGem;
    },
    getRootGemBody: function () {
      return rootGemBody;
    },
    getRootGemEdges: function () {
      return rootGemEdges;
    },
    getRootStreet: function () {
      return rootStreet;
    },
    getGemWorldPos: function () {
      return gemWorldPos;
    },
    getBuildingOutlines: function () {
      return buildingOutlines;
    },
    getBuildingOutlineMats: function () {
      return buildingOutlineMats;
    },
    getBuildingGhosts: function () {
      return buildingGhosts;
    },

    getBuildingByPath: function (p) {
      return buildingsByPath[p] || null;
    },
    getSidewalkByDir: function (p) {
      return sidewalksByDirPath[p] || null;
    },
    getStreetByDir: function (p) {
      return streetsByDirPath[p] || null;
    },
    getPathConnectorsByDir: function (p) {
      return pathMeshesByDirPath[p] || [];
    },

    // Bulk-map accessors. Treat the returned objects as read-only —
    // their identities are stable within an applyManifest call but
    // get replaced wholesale on the next one. Exposed because some
    // existing callers (e.g. computePathPoints in scene/path.js) take
    // a whole `{ dirPath: street }` map. New consumers should prefer
    // the per-key getters above.
    getBuildingsByPath: function () {
      return buildingsByPath;
    },
    getSidewalksByDirMap: function () {
      return sidewalksByDirPath;
    },
    getStreetsByDirMap: function () {
      return streetsByDirPath;
    },
    getPathConnectorsMap: function () {
      return pathMeshesByDirPath;
    },
  };
}

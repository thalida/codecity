// scene/cityScene.ts — owns the persistent THREE.Scene plus every
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
import { RENDER_ORDERS } from '../constants';
import { NodeKind, StreetAxis } from '../types';

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

export function createCityScene(canvas: HTMLCanvasElement) {
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
    for (const cb of [...arr]) {
      try {
        cb(payload);
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
    if (!obj || obj.userData?.disposed) return;
    if (obj.geometry?.dispose) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (!m) continue;
      // Dispose any texture attached to this material.
      for (const key in m) {
        if (!Object.hasOwn(m, key)) continue;
        const v = m[key];
        if (v?.isTexture && typeof v.dispose === 'function') v.dispose();
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
    for (const bm of buildingMeshes) {
      if (bm.userData) bm.userData.paired = null;
    }
    for (const m of buildingMeshes) _removeAndDispose(m);
    for (const m of streetPickables) _removeAndDispose(m);
    for (const m of streetLabels) _removeAndDispose(m);
    for (const m of pathMeshes) _removeAndDispose(m);
    for (const m of asphaltMeshes) _removeAndDispose(m);
    for (const m of buildingOutlines) _removeAndDispose(m);
    for (const m of buildingGhosts) _removeAndDispose(m);
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

    for (const bm of buildingMeshes) {
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
    for (const sw of streetPickables) {
      const swStreet = sw.userData.street;
      const swDir = swStreet?.dir;
      if (swDir?.path != null) {
        sidewalksByDirPath[swDir.path] = sw;
        streetsByDirPath[swDir.path] = swStreet;
      }
    }

    buildingsByPath = {};
    for (const bm of buildingMeshes) {
      const bd = bm.userData.building;
      if (bd?.file?.path != null) {
        buildingsByPath[bd.file.path] = { mesh: bm, building: bd };
      }
    }

    pathMeshesByDirPath = {};
    for (const pm of pathMeshes) {
      const pmFile = pm.userData.file;
      const pmDir = pmFile?.path != null ? parentDirPath(pmFile.path) : null;
      if (pmDir == null) continue;
      if (!pathMeshesByDirPath[pmDir]) pathMeshesByDirPath[pmDir] = [];
      pathMeshesByDirPath[pmDir].push(pm);
    }
  }

  function _computeRootStreetAndGem() {
    rootStreet = (layout?.streets ?? []).filter((s) => s.isRoot)[0] || null;
    if (!rootStreet) {
      gemWorldPos = null;
      return;
    }
    gemWorldPos = new THREE.Vector3();
    if (rootStreet.orientation === StreetAxis.X) {
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
    for (const bm of prev.buildings ?? []) {
      const fp = bm.userData.building?.file?.path;
      if (fp != null) prevBuildings[fp] = bm;
    }
    const prevStreets = {};
    for (const sw of prev.streetPickables ?? []) {
      const dp = sw.userData.street?.dir?.path;
      if (dp != null) prevStreets[dp] = sw;
    }

    const entering = { buildings: [], streets: [] };
    const exiting = { buildings: [], streets: [] };
    const staying = { buildings: [], streets: [] };

    for (const nbm of buildingMeshes) {
      const nfp = nbm.userData.building?.file?.path;
      if (nfp == null) continue;
      if (Object.hasOwn(prevBuildings, nfp)) {
        staying.buildings.push({ oldMesh: prevBuildings[nfp], newMesh: nbm });
        delete prevBuildings[nfp];
      } else {
        entering.buildings.push({ mesh: nbm });
      }
    }
    for (const ek in prevBuildings) {
      if (Object.hasOwn(prevBuildings, ek)) {
        exiting.buildings.push({ mesh: prevBuildings[ek] });
      }
    }

    for (const nsw of streetPickables) {
      const ndp = nsw.userData.street?.dir?.path;
      if (ndp == null) continue;
      if (Object.hasOwn(prevStreets, ndp)) {
        staying.streets.push({ oldMesh: prevStreets[ndp], newMesh: nsw });
        delete prevStreets[ndp];
      } else {
        entering.streets.push({ mesh: nsw });
      }
    }
    for (const sk in prevStreets) {
      if (Object.hasOwn(prevStreets, sk)) {
        exiting.streets.push({ mesh: prevStreets[sk] });
      }
    }

    return { entering, exiting, staying };
  }

  function applyManifest(newManifest) {
    const prev = {
      buildings: buildingMeshes,
      streetPickables,
      streetLabels,
      pathMeshes,
      asphaltMeshes,
      rootGem,
      manifest,
      layout,
    };

    _emit(beforeChangeCbs, prev);

    // Capture old building transforms BEFORE disposal so the animator
    // can tween "staying" meshes from their old position to the new
    // one without a snap. Keyed by file.path — stable across rebuilds.
    const prevBuildingTransforms = {};
    for (const pm of buildingMeshes) {
      const pf = pm.userData.building?.file;
      if (pf?.path != null) {
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
    const buildings = layout?.buildings ?? [];
    for (const b of buildings) {
      b.color = b.file?.type === NodeKind.File ? getBuildingColor(b.file, dateRanges) : dirColor;
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
    for (const child of [...built.scene.children]) scene.add(child);
    // buildCityScene also set its own scene.background; mirror onto ours.
    scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

    // Stamp the gem body so it can participate in raycast picking.
    if (rootGem) {
      const gemBody = rootGem.children?.[0];
      if (gemBody) gemBody.userData.type = NodeKind.Gem;
    }

    _buildOutlinesAndGhosts();
    _buildLookups();
    _computeRootStreetAndGem();

    const diff = _computeDiff(prev);
    // Attach transform snapshots so the animator can tween from the
    // previous mesh's resting place. For entering meshes, no prev
    // exists, so just expose the target. For staying, both.
    for (const entry of diff.entering.buildings) {
      entry.newPosition = entry.mesh.position.clone();
      entry.newScaleY = entry.mesh.scale.y;
    }
    for (const entry of diff.staying.buildings) {
      const nm = entry.newMesh;
      const fp = nm.userData.building?.file?.path;
      const oldT = fp != null ? prevBuildingTransforms[fp] : null;
      if (oldT) {
        entry.oldPosition = oldT.position;
        entry.oldScaleY = oldT.scaleY;
      }
      entry.newPosition = nm.position.clone();
      entry.newScaleY = nm.scale.y;
    }

    _emit(changeCbs, diff);
  }

  function dispose() {
    _disposeAllManifestState();
    _ghostBoxGeo?.dispose?.();
    beforeChangeCbs.length = 0;
    changeCbs.length = 0;
  }

  return {
    scene,
    applyManifest,
    dispose,
    onBeforeChange,
    onChange,
    disposeMesh,

    getManifest() {
      return manifest;
    },
    getLayout() {
      return layout;
    },
    getBbox() {
      return bbox;
    },
    getRoot() {
      return manifest && manifest.tree;
    },
    getDateRanges() {
      return dateRanges;
    },
    getBuildings() {
      return buildingMeshes;
    },
    getStreetPickables() {
      return streetPickables;
    },
    getStreetLabels() {
      return streetLabels;
    },
    getPathMeshes() {
      return pathMeshes;
    },
    getAsphaltMeshes() {
      return asphaltMeshes;
    },
    getRootGem() {
      return rootGem;
    },
    getRootGemBody() {
      return rootGemBody;
    },
    getRootGemEdges() {
      return rootGemEdges;
    },
    getRootStreet() {
      return rootStreet;
    },
    getGemWorldPos() {
      return gemWorldPos;
    },
    getBuildingOutlines() {
      return buildingOutlines;
    },
    getBuildingOutlineMats() {
      return buildingOutlineMats;
    },
    getBuildingGhosts() {
      return buildingGhosts;
    },

    getBuildingByPath(p) {
      return buildingsByPath[p] || null;
    },
    getSidewalkByDir(p) {
      return sidewalksByDirPath[p] || null;
    },
    getStreetByDir(p) {
      return streetsByDirPath[p] || null;
    },
    getPathConnectorsByDir(p) {
      return pathMeshesByDirPath[p] || [];
    },

    // Bulk-map accessors. Treat the returned objects as read-only —
    // their identities are stable within an applyManifest call but
    // get replaced wholesale on the next one. Exposed because some
    // existing callers (e.g. computePathPoints in scene/path.js) take
    // a whole `{ dirPath: street }` map. New consumers should prefer
    // the per-key getters above.
    getBuildingsByPath() {
      return buildingsByPath;
    },
    getSidewalksByDirMap() {
      return sidewalksByDirPath;
    },
    getStreetsByDirMap() {
      return streetsByDirPath;
    },
    getPathConnectorsMap() {
      return pathMeshesByDirPath;
    },
  };
}

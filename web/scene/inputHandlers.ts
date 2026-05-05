// scene/inputHandlers.ts — pointer / dblclick / keydown / resize
// wiring. Translates DOM events into picker and cameraRig calls.
//
// Public contract:
//   const handlers = createInputHandlers({
//     canvas, picker, rig, renderer, camera,
//     onResize: function () { /* renderer-specific onResize work */ },
//     showTooltip, hideTooltip,            // tooltip api (from views/shell/tooltip.js)
//   });
//   handlers.dispose();

import * as THREE from 'three';
import { INPUT_TIMING } from '../config/index.js';
import { NodeKind } from '../types';
import type { PickTarget } from '../types';
import type { createPicker } from './picker.js';
import type { createCameraRig } from './cameraRig.js';

export function createInputHandlers({
  canvas,
  picker,
  rig,
  renderer,
  camera,
  scene,
  showTooltip,
  hideTooltip,
  onResize,
}: {
  canvas: HTMLCanvasElement;
  picker: ReturnType<typeof createPicker>;
  rig: ReturnType<typeof createCameraRig>;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  showTooltip: (text: string, x: number, y: number) => void;
  hideTooltip: () => void;
  onResize: () => void;
}) {
  // Click vs. drag: pointerdown→pointerup with movement + time threshold.
  let downX = 0,
    downY = 0,
    downTime = 0;

  // Hover pipeline: pointermove fires faster than render frames, so
  // coalesce events into one raycast per rAF tick. Result sits in a
  // short commit-delay buffer so brief brushes don't engage the heavy
  // cascade fade (the buildingFader's tier change). Tooltip + cursor
  // update on every coalesced raycast for responsiveness — only the
  // hover commit is debounced.
  let _hoverRafId = 0;
  let _hoverLastEvt = null;
  let _hoverPending = null;
  let _hoverCommitId = 0;

  function _tooltipForHover(target: PickTarget | null): string | null {
    if (!target) return null;
    if (target.kind === NodeKind.Gem) {
      // Resolve via picker → cityScene only as needed; we don't keep a
      // direct cityScene ref here.
      return 'root';
    }
    if (target.kind === NodeKind.File && target.file) {
      const f = target.file;
      const fpath = f.path || f.name || 'file';
      return fpath + (f.lines != null ? `  ·  ${f.lines} lines` : '');
    }
    if (target.kind === NodeKind.Directory && target.dir) {
      const d = target.dir;
      const dpath = d.path || d.name || 'directory';
      const fileCount = d.descendants_file_count != null ? d.descendants_file_count : 0;
      const dirCount = d.descendants_dir_count != null ? d.descendants_dir_count : 0;
      const counts = `${fileCount} file${fileCount === 1 ? '' : 's'}, ${dirCount} dir${
        dirCount === 1 ? '' : 's'
      }`;
      return `${dpath}  ·  ${counts}`;
    }
    return null;
  }

  function _sameHover(a: PickTarget | null, b: PickTarget | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    // a.kind === b.kind is established; narrow b alongside a for member access.
    if (a.kind === NodeKind.File) return a.mesh === (b as typeof a).mesh;
    if (a.kind === NodeKind.Directory) return a.sidewalk === (b as typeof a).sidewalk;
    if (a.kind === NodeKind.Gem) return true;
    return false;
  }

  function _processHoverRaf() {
    _hoverRafId = 0;
    const e = _hoverLastEvt;
    if (!e) return;
    const hit = picker.pickAt(e.clientX, e.clientY);
    let newHover = picker.interpretHit(hit);
    // Filter: directory-shaped targets that came from a stray "directory
    // building" (engine.js typically skips these) don't have a sidewalk
    // — treat as no hover.
    if (newHover && newHover.kind === NodeKind.Directory && !newHover.sidewalk) {
      newHover = null;
    }
    const tooltipText = _tooltipForHover(newHover);

    if (tooltipText) {
      showTooltip(tooltipText, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      hideTooltip();
      canvas.style.cursor = 'grab';
    }

    if (_sameHover(newHover, picker.hover.get())) {
      if (_hoverCommitId) {
        clearTimeout(_hoverCommitId);
        _hoverCommitId = 0;
      }
      _hoverPending = null;
      return;
    }
    if (_hoverCommitId && _sameHover(newHover, _hoverPending)) return;
    _hoverPending = newHover;
    if (_hoverCommitId) clearTimeout(_hoverCommitId);
    _hoverCommitId = setTimeout(() => {
      _hoverCommitId = 0;
      const toCommit = _hoverPending;
      _hoverPending = null;
      if (!_sameHover(toCommit, picker.hover.get())) picker.setHover(toCommit);
    }, INPUT_TIMING.get().HOVER_COMMIT_MS);
  }

  function _handlePick(clientX: number, clientY: number): void {
    const hit = picker.pickAt(clientX, clientY);
    if (!hit) {
      picker.setSelection(null);
      return;
    }
    if (hit.object.userData.type === NodeKind.Gem) {
      picker.setSelection(null);
      rig.reset();
      return;
    }
    picker.setSelection(picker.interpretHit(hit));
  }

  function _focusAtPointer(clientX: number, clientY: number): void {
    const hit = picker.pickAt(clientX, clientY);
    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.type === NodeKind.Gem) {
      rig.reset();
      return;
    }
    if (ud.building && ud.building.file && ud.building.file.type === NodeKind.File) {
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
  let _disposers: Array<() => void> = [];
  // The native EventTarget.addEventListener overloads are tightly typed
  // by event name; this helper is generic across canvas/document/window
  // and several event kinds, so the parameter types intentionally widen.
  function _on(target: EventTarget, event: string, fn: (e: Event) => void): void {
    target.addEventListener(event, fn);
    _disposers.push(() => {
      target.removeEventListener(event, fn);
    });
  }

  _on(canvas, 'pointerdown', (e: Event) => {
    const ev = e as PointerEvent;
    downX = ev.clientX;
    downY = ev.clientY;
    downTime = Date.now();
  });

  _on(canvas, 'pointerup', (e: Event) => {
    const ev = e as PointerEvent;
    if (ev.button !== 0) return;
    const dx = ev.clientX - downX;
    const dy = ev.clientY - downY;
    const dtime = Date.now() - downTime;
    const input = INPUT_TIMING.get();
    const moveSq = input.CLICK_MOVE_THRESHOLD_PX * input.CLICK_MOVE_THRESHOLD_PX;
    if (dx * dx + dy * dy > moveSq) return;
    if (dtime > input.CLICK_TIME_THRESHOLD_MS) return;
    _handlePick(ev.clientX, ev.clientY);
  });

  _on(canvas, 'pointermove', (e: Event) => {
    _hoverLastEvt = e as PointerEvent;
    if (_hoverRafId) return;
    _hoverRafId = requestAnimationFrame(_processHoverRaf);
  });

  _on(canvas, 'pointerleave', () => {
    hideTooltip();
    if (_hoverRafId) {
      cancelAnimationFrame(_hoverRafId);
      _hoverRafId = 0;
    }
    if (_hoverCommitId) {
      clearTimeout(_hoverCommitId);
      _hoverCommitId = 0;
    }
    _hoverPending = null;
    picker.setHover(null);
  });

  _on(canvas, 'dblclick', (e: Event) => {
    const ev = e as MouseEvent;
    _focusAtPointer(ev.clientX, ev.clientY);
  });

  _on(document, 'keydown', (e: Event) => {
    const ev = e as KeyboardEvent;
    const targetEl = ev.target as (HTMLElement & { isContentEditable?: boolean }) | null;
    const tag = (targetEl && targetEl.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (targetEl && targetEl.isContentEditable)) return;

    if (ev.key === 'Escape') {
      picker.setSelection(null);
      picker.setHover(null);
    } else if (ev.key === 'r' || ev.key === 'R' || ev.key === 'Home') {
      rig.reset();
    } else if (ev.key === 'f' || ev.key === 'F') {
      const sel = picker.selection.get();
      if (!sel) return;
      if (sel.kind === NodeKind.File) {
        rig.focusBuilding(sel.mesh, sel.data);
      } else if (sel.kind === NodeKind.Directory) {
        rig.focusStreet(sel.street, null);
      }
    }
  });

  function _resize() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
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
  let _resizeObs = null;
  if (typeof ResizeObserver !== 'undefined') {
    _resizeObs = new ResizeObserver(_resize);
    _resizeObs.observe(canvas);
    _disposers.push(() => {
      _resizeObs.disconnect();
    });
  }

  function dispose() {
    for (let i = 0; i < _disposers.length; i++) {
      try {
        _disposers[i]();
      } catch (_) {
        /* noop */
      }
    }
    _disposers = [];
    if (_hoverRafId) cancelAnimationFrame(_hoverRafId);
    if (_hoverCommitId) clearTimeout(_hoverCommitId);
  }

  return { dispose };
}

// scene/inputHandlers.ts — pointer / dblclick / keydown / resize
// wiring. Translates DOM events into picker and cameraRig calls.
//
// Public contract:
//   const handlers = createInputHandlers({
//     canvas, picker, rig, renderer, camera,
//     onResize: function () { /* renderer-specific onResize work */ },
//     showTooltip, hideTooltip,            // tooltip api (from views/widgets/tooltip.js)
//   });
//   handlers.dispose();

import * as THREE from 'three';
import { INPUT_TIMING } from '@/config/index.js';
import { KEY_BINDINGS, TEXT_INPUT_TAGS } from '@/constants';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types';
import { formatRelativeAge } from '@/views/widgets/formatRelativeAge.js';
import type { createPicker } from './picker.js';
import type { createCameraRig } from './cameraRig.js';
import type { createFlyControls } from './flyControls.js';

export function createInputHandlers({
  canvas,
  picker,
  rig,
  flyControls,
  renderer,
  camera,
  showTooltip,
  hideTooltip,
  onResize,
  onResetView,
  getRootName,
}: {
  canvas: HTMLCanvasElement;
  picker: ReturnType<typeof createPicker>;
  rig: ReturnType<typeof createCameraRig>;
  flyControls: ReturnType<typeof createFlyControls>;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  showTooltip: (text: string, x: number, y: number) => void;
  hideTooltip: () => void;
  onResize: () => void;
  /** Reset-view action triggered by R / gem-click. In orbit mode this
   *  resets the camera; in fly mode it routes to flyControls.resetToDefault().
   *  Does NOT rebuild the manifest — a page reload is required for that. */
  onResetView: () => void;
  /** Resolve the current root directory name for hover-tooltip prefixing.
   * Called lazily on each hover so it stays in sync after manifest reloads. */
  getRootName: () => string | null;
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
  let _hoverCommitId: ReturnType<typeof setTimeout> | 0 = 0;

  let _cameraMoving = false;

  // Prepend the root directory name (with a leading slash) to a manifest-
  // relative path so the hover tooltip reads as an absolute-looking path
  // (e.g. "/codecity/web/main.ts" rather than "web/main.ts"). The manifest
  // uses '.' as the root directory's own path; that sentinel is treated
  // the same as empty — we don't render "codecity/.".
  function _withRoot(relPath: string): string {
    const root = getRootName();
    if (!root) return relPath || '';
    if (!relPath || relPath === '.') return `/${root}`;
    return `/${root}/${relPath}`;
  }

  function _tooltipForHover(target: PickTarget | null): string | null {
    if (!target) return null;
    if (target.kind === NodeKind.Gem) {
      // The gem represents the project root and also acts as the reset
      // button — clicking it clears the selection and recenters the
      // camera. Show both so the affordance is discoverable.
      return `${_withRoot('')}  ·  click to reset view`;
    }
    if (target.kind === NodeKind.Commit) {
      const c = target.commit;
      const shortSha = c.sha.slice(0, 7);
      return `commit ${shortSha}  ·  ${formatRelativeAge(c.date)}`;
    }
    if (target.kind === NodeKind.File && target.file) {
      const f = target.file;
      const fpath = _withRoot(f.path || f.name || 'file');
      return fpath + (f.lines != null ? `  ·  ${f.lines} lines` : '');
    }
    if (target.kind === NodeKind.Directory && target.dir) {
      const d = target.dir;
      const dpath = _withRoot(d.path || d.name || '');
      // Show immediate-child counts (not descendants) — the tooltip is a
      // quick "what's directly inside here", not a subtree summary.
      const fileCount = d.children_file_count != null ? d.children_file_count : 0;
      const dirCount = d.children_dir_count != null ? d.children_dir_count : 0;
      const counts = `${fileCount} file${fileCount === 1 ? '' : 's'}, ${dirCount} dir${
        dirCount === 1 ? '' : 's'
      }`;
      return `${dpath || 'directory'}  ·  ${counts}`;
    }
    return null;
  }

  function _sameHover(a: PickTarget | null, b: PickTarget | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    // a.kind === b.kind is established; narrow b alongside a for member access.
    if (a.kind === NodeKind.File) {
      // All buildings in a block share one InstancedMesh, so mesh-equality
      // is too coarse — moving cursor between two buildings in the same
      // block would never re-fire hover. Compare by file path (the
      // canonical building identity).
      return a.file?.path === (b as typeof a).file?.path;
    }
    if (a.kind === NodeKind.Directory) return a.sidewalk === (b as typeof a).sidewalk;
    if (a.kind === NodeKind.Commit) {
      return a.commit.sha === (b as typeof a).commit.sha;
    }
    if (a.kind === NodeKind.Gem) return true;
    return false;
  }

  function _processHoverRaf() {
    _hoverRafId = 0;
    // Suppress hover while camera is moving — orbit drag (start/end events)
    // OR fly-mode look-drag (left/right click held in fly mode). The
    // outline/fader cascade is visually noisy while the camera rotates,
    // so we just skip the raycast until the drag ends.
    if (_cameraMoving) return;
    if (flyControls.isLooking()) return;
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
      // Gem click = reset view, same as the R key and the header gem
      // button. The mode-aware reset (orbit reset vs fly-mode
      // resetToDefault) is decided inside onResetView.
      onResetView();
      return;
    }
    // Clicking the currently-selected building/street is a no-op — matches
    // Blender / Maya / Unity / Unreal / Maps / Finder. Deselect via Esc, the
    // clear-selection key binding, or by clicking empty ground. Without this
    // no-op, double-click-to-focus would race with the per-click toggle and
    // leave the target deselected on the dblclick frame.
    const next = picker.interpretHit(hit);
    if (_sameHover(next, picker.selection.get())) return;
    picker.setSelection(next);
  }

  function _focusAtPointer(clientX: number, clientY: number): void {
    const hit = picker.pickAt(clientX, clientY);
    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.type === NodeKind.Gem) {
      onResetView();
      return;
    }
    // Route through picker.interpretHit so InstancedMesh hits resolve to a
    // building/file the same way clicks do — ud.building isn't set on
    // InstancedMesh hits, so without this dblclick would fall through to
    // the recenter fallback.
    const target = picker.interpretHit(hit);
    if (target?.kind === NodeKind.File) {
      rig.focusBuilding(target.mesh, target.data);
      return;
    }
    if (target?.kind === NodeKind.Directory) {
      rig.focusStreet(target.street, hit.point);
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
    if (TEXT_INPUT_TAGS.includes(tag) || (targetEl && targetEl.isContentEditable)) return;

    if (KEY_BINDINGS.TOGGLE_FLY_MODE.keys.includes(ev.key)) {
      ev.preventDefault();
      if (flyControls.isActive()) {
        flyControls.disable();
      } else {
        flyControls.enable();
      }
      return;
    }

    if (KEY_BINDINGS.CLEAR_SELECTION.keys.includes(ev.key)) {
      // Same behaviour in both modes: clear selection. In fly mode the
      // browser also releases pointer lock on Esc, which auto-exits fly
      // mode via the pointerlockchange handler — no special branch needed.
      picker.setSelection(null);
      picker.setHover(null);
    } else if (KEY_BINDINGS.RESET_VIEW.keys.includes(ev.key)) {
      // Same behaviour in both modes: reset to current-mode default. No
      // manifest rebuild — reload the page for that.
      onResetView();
    } else if (KEY_BINDINGS.FOCUS_SELECTION.keys.includes(ev.key)) {
      const sel = picker.selection.get();
      if (!sel) return;
      if (sel.kind === NodeKind.File) {
        rig.focusBuilding(sel.mesh, sel.data);
      } else if (sel.kind === NodeKind.Directory) {
        rig.focusStreet(sel.street, null);
      }
    }
  });

  // Suppress hover while the user is orbiting/panning/zooming the camera.
  // Listens to OrbitControls' start/end (NOT change) so hover resumes
  // instantly on release, even while damping inertia continues. The
  // tradeoff: hover is not suppressed during programmatic camera tweens
  // (focusBuilding, reset) since those don't fire start/end — acceptable
  // because tweens are short and self-triggered.
  //
  // OrbitControls extends EventDispatcher (not EventTarget) so we can't
  // use the _on helper here — register and dispose manually.
  const _cameraStartHandler = () => {
    if (_cameraMoving) return;
    _cameraMoving = true;
    // Drop any in-flight hover so the highlight doesn't linger from
    // before the camera started moving.
    if (_hoverCommitId) {
      clearTimeout(_hoverCommitId);
      _hoverCommitId = 0;
    }
    _hoverPending = null;
    if (picker.hover.get()) picker.setHover(null);
    hideTooltip();
    canvas.style.cursor = 'grabbing';
  };
  const _cameraEndHandler = () => {
    _cameraMoving = false;
    canvas.style.cursor = 'grab';
  };
  rig.controls.addEventListener('start', _cameraStartHandler);
  rig.controls.addEventListener('end', _cameraEndHandler);
  _disposers.push(() => {
    rig.controls.removeEventListener('start', _cameraStartHandler);
    rig.controls.removeEventListener('end', _cameraEndHandler);
  });

  function _resize() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / Math.max(1, ch);
    camera.updateProjectionMatrix();
    // onResize owns the synchronous paint so the post-FX pipeline (bloom)
    // shows on the new size without a blank/cleared frame in between.
    if (typeof onResize === 'function') onResize();
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

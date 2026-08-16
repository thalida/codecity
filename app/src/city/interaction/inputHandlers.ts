// city/interaction/inputHandlers.ts — pointer, keydown and resize wiring:
// translates DOM events into picker and cameraRig calls, and nothing else.

import type * as THREE from 'three';
// Pointer input timing — fixed, not user-tunable.
const INPUT_CLICK_MOVE_THRESHOLD_PX = 5;
const INPUT_CLICK_TIME_THRESHOLD_MS = 400;
// A finger rolls across several pixels and rests longer than a mouse click; at
// the cursor's thresholds a deliberate tap reads as a drag and picks nothing.
const TOUCH_CLICK_MOVE_THRESHOLD_PX = 12;
const TOUCH_CLICK_TIME_THRESHOLD_MS = 700;
const INPUT_HOVER_COMMIT_MS = 35;
import { KEY_BINDINGS } from '@/constants/keyboard';
import { TEXT_INPUT_TAGS } from '@/constants/dom';
import { OVERLAY_OPEN } from '@/state/stores/modals';
import { openSelectionPane } from '@/state/stores/sidebars';
import { focusSelection } from '@/state/stores/scene';
import { NodeKind } from '@/types';
import { scrubbedStatsFor } from '@/state/stores/scrub';
import type { PickTarget } from '@/types';
import { hoverTooltipContent, type TooltipContent } from './tooltipText';
import type { createPicker } from './picker';
import type { createCameraRig } from '../render/cameraRig';
import type { CityState } from '../state';

export function createInputHandlers({
  canvas,
  picker,
  rig,
  renderer,
  cityState,
  showTooltip,
  hideTooltip,
  onResize,
  onResetView,
}: {
  canvas: HTMLCanvasElement;
  picker: ReturnType<typeof createPicker>;
  rig: ReturnType<typeof createCameraRig>;
  renderer: THREE.WebGLRenderer;
  cityState: CityState;
  showTooltip: (content: TooltipContent, x: number, y: number) => void;
  hideTooltip: () => void;
  onResize: () => void;
  /** Reset-view action triggered by R / gem-click. Does NOT rebuild the
   *  manifest — a page reload is required for that. */
  onResetView: () => void;
}) {
  // Click vs. drag: pointerdown→pointerup with movement + time threshold.
  let downX = 0,
    downY = 0,
    downTime = 0;

  // One raycast per frame, then a short delay before committing, so brushing
  // past a building doesn't engage the cascade fade. Only the commit waits.
  let _hoverRafId = 0;
  let _hoverLastEvt = null;
  let _hoverPending = null;
  let _hoverCommitId: ReturnType<typeof setTimeout> | 0 = 0;

  let _cameraMoving = false;

  function _sameHover(a: PickTarget | null, b: PickTarget | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    // a.kind === b.kind is established; narrow b alongside a for member access.
    if (a.kind === NodeKind.File) {
      // A block's buildings share one mesh, so mesh equality would never
      // re-fire hover between two of them. Path is the identity.
      return a.file?.path === (b as typeof a).file?.path;
    }
    // All directories share one merged sidewalk mesh, so compare by dir path.
    if (a.kind === NodeKind.Directory) return a.dir?.path === (b as typeof a).dir?.path;
    if (a.kind === NodeKind.Commit) {
      return a.commit.sha === (b as typeof a).commit.sha;
    }
    if (a.kind === NodeKind.Gem) return true;
    return false;
  }

  function _processHoverRaf() {
    _hoverRafId = 0;
    // The cascade is noisy under rotation, so the raycast waits for the drag.
    if (_cameraMoving) return;
    const e = _hoverLastEvt;
    if (!e) return;
    const hit = picker.pickAt(e.clientX, e.clientY);
    let newHover = picker.interpretHit(hit);
    // A stray directory-shaped building has no sidewalk: not a hover target.
    if (newHover && newHover.kind === NodeKind.Directory && !newHover.sidewalk) {
      newHover = null;
    }

    // peek: a hover handler wants the current name, never a subscription.
    const rootName = cityState.manifest.peek()?.tree?.name ?? null;
    const scrubLines =
      newHover?.kind === NodeKind.File && newHover.file?.path != null
        ? (scrubbedStatsFor(newHover.file.path)?.lines ?? null)
        : null;
    const tooltipText = hoverTooltipContent(newHover, rootName, scrubLines);
    if (tooltipText) {
      showTooltip(tooltipText, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      hideTooltip();
      canvas.style.cursor = 'grab';
    }

    if (_sameHover(newHover, picker.hover.value)) {
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
      if (!_sameHover(toCommit, picker.hover.value)) picker.setHover(toCommit);
    }, INPUT_HOVER_COMMIT_MS);
  }

  function _handlePick(clientX: number, clientY: number): void {
    const hit = picker.pickAt(clientX, clientY);
    if (!hit) {
      picker.setSelection(null);
      return;
    }
    if (hit.object.userData.type === NodeKind.Gem) {
      picker.setSelection(null);
      // Gem click = reset view, same as the R key.
      onResetView();
      return;
    }
    // Clicking the selection again asks for its details rather than clearing
    // it: that is the way back to a pane you closed.
    const next = picker.interpretHit(hit);
    if (_sameHover(next, picker.selection.value)) {
      openSelectionPane();
      return;
    }
    picker.setSelection(next);
    // Picking a node is asking what it is, so a pane put away for the last one
    // comes back for this one.
    openSelectionPane();
  }

  // ── Bindings ───────────────────────────────────────────────────────
  let _disposers: Array<() => void> = [];
  // addEventListener is typed per event name; this is generic across three
  // targets and several kinds, so the parameters widen deliberately.
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
    const touch = ev.pointerType === 'touch';
    const move = touch ? TOUCH_CLICK_MOVE_THRESHOLD_PX : INPUT_CLICK_MOVE_THRESHOLD_PX;
    if (dx * dx + dy * dy > move * move) return;
    if (dtime > (touch ? TOUCH_CLICK_TIME_THRESHOLD_MS : INPUT_CLICK_TIME_THRESHOLD_MS)) return;

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

  _on(document, 'keydown', (e: Event) => {
    const ev = e as KeyboardEvent;
    const targetEl = ev.target as (HTMLElement & { isContentEditable?: boolean }) | null;
    const tag = (targetEl && targetEl.tagName) || '';
    if (TEXT_INPUT_TAGS.includes(tag) || (targetEl && targetEl.isContentEditable)) return;

    // A modal owns keyboard input while open — don't let scene shortcuts
    // (Esc-deselect, R, F) fire underneath it.
    if (OVERLAY_OPEN.value) return;

    if (KEY_BINDINGS.CLEAR_SELECTION.keys.includes(ev.key)) {
      picker.setSelection(null);
      picker.setHover(null);
    } else if (KEY_BINDINGS.RESET_VIEW.keys.includes(ev.key)) {
      // No manifest rebuild — reload the page for that.
      onResetView();
    } else if (KEY_BINDINGS.FOCUS_SELECTION.keys.includes(ev.key)) {
      // The command the panes' Focus buttons call. The gem isn't selectable:
      // clicking it resets the view instead.
      focusSelection();
    }
  });

  // start/end rather than change, so hover resumes on release while damping
  // continues. OrbitControls is an EventDispatcher, so it registers manually.
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
    if (picker.hover.value) picker.setHover(null);
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

  // rAF, so the observer yields before setSize writes the canvas size and
  // re-fires it: that chain starved pointer events and killed hover outright.
  let _resizeRafId = 0;
  function _resize() {
    if (_resizeRafId) return;
    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = 0;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      renderer.setSize(cw, ch, false);
      rig.camera.aspect = cw / Math.max(1, ch);
      rig.camera.updateProjectionMatrix();
      // onResize owns the synchronous paint so the post-FX pipeline (bloom)
      // shows on the new size without a blank/cleared frame in between.
      if (typeof onResize === 'function') onResize();
    });
  }
  _on(window, 'resize', _resize);

  // A sidebar resizes the canvas without a window resize, so observe it.
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
    if (_resizeRafId) cancelAnimationFrame(_resizeRafId);
  }

  return { dispose };
}

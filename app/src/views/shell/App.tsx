// App.tsx — Real composition root. Mounts all shell components and kicks
// off the app boot logic. Phase 3e: replaces the Phase-2 placeholder.
//
// Layout:
//   <header id="app-header">  — AppHeader (reads SCENE_HANDLE + SOURCE_INFO)
//   <main id="app-body">
//     <div id="tree-sidebar"> — showLeftSidebar (called in runAppLogic)
//     <div id="center-pane">  — canvas (scene started by runAppLogic)
//     <div id="sidebar">      — mountRightSidebarReactions (called in runAppLogic)
//   </main>
//   <footer id="app-footer">  — AppFooter (reads signals directly)
//   <SourcePickerShell />     — reads SOURCE_PICKER + SERVER_CONFIG signals
//   <LoadingOverlayShell />   — reads LOADING_OVERLAY signal

import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { AppHeader } from './appHeader';
import { AppFooter } from './appFooter';
import { SourcePickerComponent } from '../components/sourcePicker';
import type { SourcePickerState } from '../components/sourcePicker';
import { LoadingOverlay } from '../components/loadingOverlay';
import type { OverlayState } from '../components/loadingOverlay';
import { SOURCE_PICKER, closeSourcePicker, LOADING_OVERLAY } from '@/state/runtime/uiState';
import { SERVER_CONFIG } from '@/state/runtime/serverConfig';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { NodeKind } from '@/types';
import { runAppLogic } from '../../appLogic';

// ── Source picker shell: bridges SOURCE_PICKER + SERVER_CONFIG → SourcePickerComponent

function SourcePickerShell() {
  // Build SourcePickerState from our two runtime signals.
  const sp = SOURCE_PICKER.value;

  // Return null (instead of letting the child render null) so the
  // SourcePickerComponent fully unmounts when the modal closes — its
  // useState-backed form inputs reset on the next open. Returning null
  // from the child only would keep it mounted with stale form state.
  if (!sp.visible) return null;

  const serverCfg = SERVER_CONFIG.value;
  const opts = sp.opts ?? {};
  const prefill = opts.prefill;
  const prefillSrc = prefill?.src ?? '';
  const isGitLike = (src: string) => /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src);

  // Stable signal so SourcePickerComponent's useState initializers run once.
  // We use a module-level signal and push updates to it.
  const pickerState = _pickerState;
  pickerState.value = {
    open: sp.visible,
    dismissible: opts.dismissible ?? false,
    // Default tab is git. Only switch to local when the prefill clearly
    // looks like a local path (non-empty AND not a git-shaped URL).
    activeTab: prefillSrc && !isGitLike(prefillSrc) ? 'local' : 'git',
    prefillSrc,
    prefillBranch: prefill?.branch ?? '',
    error: opts.error ?? null,
    allowLocalRepos: serverCfg.allowLocalRepos,
  };

  return (
    <SourcePickerComponent
      state={pickerState}
      onSubmit={(payload) => {
        const fn = (window as Window & { __applyNewSource?: (p: typeof payload) => void })
          .__applyNewSource;
        if (fn) fn(payload);
      }}
      onClose={() => closeSourcePicker()}
    />
  );
}

// Module-level signal so SourcePickerComponent's useState initializers are stable
const _pickerState = signal<SourcePickerState>({
  open: false,
  dismissible: false,
  activeTab: 'git',
  prefillSrc: '',
  prefillBranch: '',
  error: null,
  allowLocalRepos: false,
});

// ── Loading overlay shell: bridges LOADING_OVERLAY → LoadingOverlay

function LoadingOverlayShell() {
  const lo = LOADING_OVERLAY.value;
  const overlayState = _overlayState;
  overlayState.value = {
    visible: lo.visible,
    kind: lo.showOpts?.kind ?? null,
    branch: lo.showOpts?.branch ?? null,
    activeStep: lo.activeStep,
    pendingLabel: lo.pendingLabel,
    stepTails: lo.stepTails,
  };
  return <LoadingOverlay state={overlayState} />;
}

const _overlayState = signal<OverlayState>({
  visible: false,
  kind: null,
  branch: null,
  activeStep: null,
  pendingLabel: null,
  stepTails: {},
});

// ── App root ────────────────────────────────────────────────────────────────

export function App() {
  useEffect(() => {
    let disposeLogic: (() => void) | undefined;
    let cancelled = false;
    runAppLogic().then((dispose) => {
      if (!cancelled) disposeLogic = dispose;
      else dispose();
    });
    return () => {
      cancelled = true;
      disposeLogic?.();
    };
  }, []);

  // AppHeader: callbacks wire actions to scene handle (read at click-time)
  function onSegmentClick(path: string) {
    SCENE_HANDLE.peek()?.picker.selectByPath(path);
  }
  function onSwitchSource() {
    const fn = (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker;
    fn?.();
  }
  function onResetView() {
    SCENE_HANDLE.peek()?.resetView();
  }
  function onFocus() {
    const handle = SCENE_HANDLE.peek();
    if (!handle) return;
    const sel = handle.picker.selection.peek();
    if (!sel) return;
    if (sel.kind === NodeKind.File) handle.rig.focusBuilding(sel.mesh, sel.data);
    else if (sel.kind === NodeKind.Directory) handle.rig.focusStreet(sel.street, null);
    else if (sel.kind === NodeKind.Commit) handle.rig.focusTree(sel.commit.sha);
  }

  return (
    <>
      <AppHeader
        onSegmentClick={onSegmentClick}
        onSwitchSource={onSwitchSource}
        onResetView={onResetView}
        onFocus={onFocus}
      />
      <main id="app-body">
        <div id="left-sidebar" />
        <div id="center-pane">
          <canvas id="city" />
        </div>
        <div id="right-sidebar" />
      </main>
      <AppFooter />
      <SourcePickerShell />
      <LoadingOverlayShell />
    </>
  );
}

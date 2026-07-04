// layout/App.tsx — Composition root. Mounts all shell components. The scene is booted
// by <CenterPane /> (which owns the canvas); App just keeps document.title in
// sync and wires the header callbacks to the live SCENE_HANDLE.
//
// Layout:
//   <AppHeader>          — reads SCENE_HANDLE + SOURCE_INFO
//   <main id="app-body">
//     <LeftSidebar>      — self-subscribes to SCENE_HANDLE + picker
//     <CenterPane>       — owns the canvas + boots the scene
//     <RightSidebar>     — self-subscribes to SCENE_HANDLE + picker
//   </main>
//   <AppFooter>          — reads signals directly
//   <SourcePicker />     — reads SOURCE_PICKER + SERVER_CONFIG directly
//   <LoadingOverlay />   — reads LOADING_OVERLAY directly
//   <ShortcutsModal />   — reads SHORTCUTS_OPEN directly
//   <DebugModal />       — reads DEBUG_OPEN directly; scene commands passed as props

import './App.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';

import { AppHeader } from '../AppHeader/AppHeader';
import { AppFooter } from '../AppFooter/AppFooter';
import { CenterPane } from '../CenterPane/CenterPane';
import { LeftSidebar } from '../LeftSidebar/LeftSidebar';
import { RightSidebar } from '../RightSidebar/RightSidebar';
import { SourcePicker } from '@/views/SourcePicker/SourcePicker';
import { ShortcutsModal } from '@/views/ShortcutsModal/ShortcutsModal';
import { DebugModal } from '@/views/DebugModal/DebugModal';
import { LoadingOverlay } from '@/components/LoadingOverlay/LoadingOverlay';
import { HljsThemeLink } from '@/components/HljsThemeLink/HljsThemeLink';
import {
  selectPath,
  resetView,
  focusCurrentSelection,
  clearSelection,
  runCollisionCheck,
  runStemDiagnostic,
} from '@/state/stores/scene';
import {
  openSourcePicker,
  openSourcePickerForCurrentSource,
  closeSourcePicker,
} from '@/state/stores/ui';
import { SOURCE_ERROR, CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import { URL_PARAMS } from '@/constants/urlParams';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';
import { attachLoadingReactions } from '@/state/loadingReactions';

export function App() {
  useDocumentTitle();
  const submitSource = useManifestSource();

  useEffect(() => attachLoadingReactions(), []);

  // Reset the picker selection whenever a world commits, so panes derived from
  // it (the right sidebar, tree highlight) don't carry a stale node into the
  // new world. Keyed on CURRENT_SOURCE — live-reloads don't rewrite it, so an
  // in-place refresh keeps your selection.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) clearSelection();
  });

  // App coordinates the source picker; the fetch hook only reports outcomes.
  const dismissPicker = () => {
    closeSourcePicker();
    SOURCE_ERROR.value = null;
  };

  // Cold boot with no ?src → prompt for a source (non-dismissible).
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has(URL_PARAMS.SRC)) {
      openSourcePicker({ dismissible: false });
    }
  }, []);

  // A source-load failure (boot or submit) reopens the picker. Dismissible only
  // when a city is already loaded to fall back to (a failed FIRST pick stays
  // non-dismissible so the app can't end up blank).
  useSignalEffect(() => {
    const err = SOURCE_ERROR.value;
    if (!err) return;
    openSourcePicker({
      dismissible: !isEmptyManifest(MANIFEST.peek()),
      prefill: err.prefill,
      error: err.error,
    });
  });

  return (
    <>
      <AppHeader
        onSegmentClick={selectPath}
        onSwitchSource={openSourcePickerForCurrentSource}
        onResetView={resetView}
        onFocus={focusCurrentSelection}
      />
      <main id="app-body">
        <LeftSidebar />
        <CenterPane />
        <RightSidebar />
      </main>
      <AppFooter />
      <SourcePicker
        onSubmit={(p) => {
          dismissPicker();
          submitSource(p);
        }}
        onClose={dismissPicker}
      />
      <LoadingOverlay />
      <ShortcutsModal />
      <DebugModal onRunCollisionCheck={runCollisionCheck} onRunStemDiagnostic={runStemDiagnostic} />
      <HljsThemeLink />
    </>
  );
}

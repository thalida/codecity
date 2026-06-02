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

import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';

import { AppHeader } from './AppHeader';
import { AppFooter } from './AppFooter';
import { CenterPane } from './CenterPane';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { SourcePicker } from '@/views/SourcePicker';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { HljsThemeLink } from '@/components/HljsThemeLink';
import { selectPath, resetView, focusCurrentSelection } from '@/state/stores/scene';
import { openSourcePicker, openSourcePickerForCurrentSource, closeSourcePicker } from '@/state/stores/ui';
import { SOURCE_ERROR } from '@/state/stores/source';
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
        onSubmit={(p) => { dismissPicker(); submitSource(p); }}
        onClose={dismissPicker}
      />
      <LoadingOverlay />
      <HljsThemeLink />
    </>
  );
}

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

import { AppHeader } from './AppHeader';
import { AppFooter } from './AppFooter';
import { CenterPane } from './CenterPane';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { SourcePicker } from '@/views/SourcePicker';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { HljsThemeLink } from '@/components/HljsThemeLink';
import { selectPath, resetView, focusCurrentSelection } from '@/state/stores/scene';
import { openSourcePickerForCurrentSource, closeSourcePicker } from '@/state/stores/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';

export function App() {
  useDocumentTitle();
  const submitSource = useManifestSource();

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
      <SourcePicker onSubmit={submitSource} onClose={closeSourcePicker} />
      <LoadingOverlay />
      <HljsThemeLink />
    </>
  );
}

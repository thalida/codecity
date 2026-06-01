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
import { SCENE_HANDLE } from '@/state/stores/scene';
import { openSourcePickerForCurrentSource } from '@/state/stores/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function App() {
  useDocumentTitle();

  function onSegmentClick(path: string) {
    SCENE_HANDLE.peek()?.picker.selectByPath(path);
  }
  function onSwitchSource() {
    openSourcePickerForCurrentSource();
  }
  function onResetView() {
    SCENE_HANDLE.peek()?.resetView();
  }
  function onFocus() {
    const handle = SCENE_HANDLE.peek();
    if (!handle) return;
    handle.rig.focusSelection(handle.picker.selection.peek());
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
        <LeftSidebar />
        <CenterPane />
        <RightSidebar />
      </main>
      <AppFooter />
      <SourcePicker />
      <LoadingOverlay />
      <HljsThemeLink />
    </>
  );
}

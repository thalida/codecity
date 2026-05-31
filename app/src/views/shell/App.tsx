// App.tsx — Composition root. Mounts all shell components and kicks off
// the app boot logic via runAppLogic() in a useEffect.
//
// Layout:
//   <AppHeader>               — reads SCENE_HANDLE + SOURCE_INFO
//   <main id="app-body">
//     <div id="left-sidebar"> — populated by showLeftSidebar (in runAppLogic)
//     <div id="center-pane">  — canvas (scene started by runAppLogic)
//     <div id="right-sidebar"> — populated by mountRightSidebarReactions
//   </main>
//   <AppFooter>               — reads signals directly
//   <SourcePicker />          — reads SOURCE_PICKER + SERVER_CONFIG directly
//   <LoadingOverlay />        — reads LOADING_OVERLAY directly

import { useEffect } from 'preact/hooks';
import { AppHeader } from './appHeader';
import { AppFooter } from './appFooter';
import { SourcePicker } from '../components/sourcePicker';
import { LoadingOverlay } from '../components/loadingOverlay';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { NodeKind } from '@/types';
import { runAppLogic } from '../../appLogic';

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
      <SourcePicker />
      <LoadingOverlay />
    </>
  );
}

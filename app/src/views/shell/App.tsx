// App.tsx — Composition root. Mounts all shell components and kicks off
// the app boot logic via runAppLogic() in a useEffect.
//
// Layout:
//   <AppHeader>                  — reads SCENE_HANDLE + SOURCE_INFO
//   <main id="app-body">
//     <LeftSidebarShell>         — <aside> owned by LeftSidebar; imperative
//                                  showLeftSidebar populates it inside runAppLogic
//     <CenterPane>                — canvas (scene started by runAppLogic)
//     <RightSidebarShell>        — <aside> owned by RightSidebar; mounted
//                                  panes managed by mountRightSidebarReactions
//   </main>
//   <AppFooter>               — reads signals directly
//   <SourcePicker />          — reads SOURCE_PICKER + SERVER_CONFIG directly
//   <LoadingOverlay />        — reads LOADING_OVERLAY directly

import { useEffect } from 'preact/hooks';
import { AppHeader } from './AppHeader';
import { AppFooter } from './AppFooter';
import { CenterPane } from './CenterPane';
import { LeftSidebarShell } from './LeftSidebar';
import { RightSidebarShell } from './RightSidebar';
import { SourcePicker } from '../components/SourcePicker';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { HljsThemeLink } from '../components/HljsThemeLink';
import { SCENE_HANDLE } from '@/state/runtime/scene';
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
        <LeftSidebarShell />
        <CenterPane />
        <RightSidebarShell />
      </main>
      <AppFooter />
      <SourcePicker />
      <LoadingOverlay />
      <HljsThemeLink />
    </>
  );
}

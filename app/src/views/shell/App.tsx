// App.tsx — Composition root. Mounts all shell components and kicks off
// the app boot logic via runAppLogic() in a useEffect.
//
// Layout:
//   <AppHeader>          — reads SCENE_HANDLE + SOURCE_INFO
//   <main id="app-body">
//     <LeftSidebar>      — self-subscribes to SCENE_HANDLE + picker
//     <CenterPane>       — canvas (scene started by runAppLogic)
//     <RightSidebar>     — self-subscribes to SCENE_HANDLE + picker
//   </main>
//   <AppFooter>          — reads signals directly
//   <SourcePicker />     — reads SOURCE_PICKER + SERVER_CONFIG directly
//   <LoadingOverlay />   — reads LOADING_OVERLAY directly

import { useEffect } from 'preact/hooks';
import { AppHeader } from './AppHeader';
import { AppFooter } from './AppFooter';
import { CenterPane } from './CenterPane';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
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

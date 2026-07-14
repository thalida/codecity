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
//   <ProjectsView />     — reads PROJECTS_VIEW + SERVER_CONFIG directly; owns
//                          inline progress for a switch it initiates
//   <LoadingOverlay />   — reads LOADING_OVERLAY directly; deep-link boot only
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
import { ProjectsView } from '@/views/ProjectsView/ProjectsView';
import { ShortcutsModal } from '@/views/ShortcutsModal/ShortcutsModal';
import { DebugModal } from '@/views/DebugModal/DebugModal';
import { LoadingOverlay } from '@/components/LoadingOverlay/LoadingOverlay';
import { HljsThemeLink } from '@/components/HljsThemeLink/HljsThemeLink';
import { SelectionAnnouncer } from '@/components/SelectionAnnouncer/SelectionAnnouncer';
import {
  selectPath,
  resetView,
  focusCurrentSelection,
  clearSelection,
  runCollisionCheck,
  runStemDiagnostic,
} from '@/state/stores/scene';
import { openProjectsView, closeProjectsView } from '@/state/stores/ui';
import { SOURCE_ERROR, CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import { URL_PARAMS } from '@/constants/urlParams';
import { srcNeedsBranch } from '@/utils/sources';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';
import { attachLoadingReactions } from '@/state/loadingReactions';

export function App() {
  useDocumentTitle();
  const { submitSource, cancelLoad } = useManifestSource();

  useEffect(() => attachLoadingReactions(), []);

  // A committed switch: CURRENT_SOURCE is written ONLY on a successful load,
  // so reacting here both resets the picker selection (panes derived from it —
  // the right sidebar, tree highlight — must not carry a stale node into the
  // new world) and auto-closes the view to reveal the new city. One reaction,
  // one concern: "a world committed". No-op on deep-link boot (view already
  // closed) and on live-updates (they don't rewrite CURRENT_SOURCE).
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) {
      clearSelection();
      closeProjectsView();
    }
  });

  // App coordinates the projects view; the fetch hook only reports outcomes.
  const dismissView = () => {
    closeProjectsView();
    SOURCE_ERROR.value = null;
  };

  // Cold boot needs a source pick when there's no ?src, OR when ?src is a remote
  // URL with no ?branch (branch choice is explicit — the hook won't auto-load
  // it). Prefill the URL so the picker resolves its branches and preselects the
  // default. Non-dismissible either way: nothing is loaded to fall back to.
  useEffect(() => {
    const qp = new URLSearchParams(window.location.search);
    const src = qp.get(URL_PARAMS.SRC);
    const branch = qp.get(URL_PARAMS.BRANCH) ?? undefined;
    if (!src) {
      openProjectsView({ dismissible: false });
    } else if (srcNeedsBranch(src, branch)) {
      openProjectsView({ dismissible: false, prefill: { src } });
    }
  }, []);

  // A source-load failure (boot or submit) reopens the view. Dismissible only
  // when a city is already loaded to fall back to (a failed FIRST pick stays
  // non-dismissible so the app can't end up blank).
  useSignalEffect(() => {
    const err = SOURCE_ERROR.value;
    if (!err) return;
    openProjectsView({
      dismissible: !isEmptyManifest(MANIFEST.peek()),
      prefill: err.prefill,
      error: err.error,
    });
  });

  return (
    <>
      <a class="skip-link" href="#app-body">
        Skip to content
      </a>
      <AppHeader
        onSegmentClick={selectPath}
        onSwitchSource={() => openProjectsView({ dismissible: true })}
        onResetView={resetView}
        onFocus={focusCurrentSelection}
      />
      <main id="app-body" tabIndex={-1}>
        <LeftSidebar />
        <CenterPane />
        <RightSidebar />
      </main>
      <AppFooter />
      <ProjectsView onSubmit={(p) => submitSource(p)} onCancel={cancelLoad} onClose={dismissView} />
      <LoadingOverlay
        onCancel={() => {
          cancelLoad();
          openProjectsView({ dismissible: false });
        }}
      />
      <ShortcutsModal />
      <DebugModal onRunCollisionCheck={runCollisionCheck} onRunStemDiagnostic={runStemDiagnostic} />
      <HljsThemeLink />
      <SelectionAnnouncer />
    </>
  );
}

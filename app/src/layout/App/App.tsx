// layout/App.tsx — the composition root. CenterPane owns the canvas and boots
// the scene; everything else subscribes to the signals it needs, so App only
// keeps the title in sync and reacts to a world being committed.

import './App.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';

import { AppHeader } from '../AppHeader/AppHeader';
import { AppFooter } from '../AppFooter/AppFooter';
import { CenterPane } from '../CenterPane/CenterPane';
import { LeftSidebar } from '../LeftSidebar/LeftSidebar';
import { RightSidebar } from '../RightSidebar/RightSidebar';
import { ProjectsView } from '@/views/ProjectsView/ProjectsView';
import { LoadingOverlay } from '@/components/LoadingOverlay/LoadingOverlay';
import { HljsThemeLink } from '@/components/HljsThemeLink/HljsThemeLink';
import { SelectionAnnouncer } from '@/components/SelectionAnnouncer/SelectionAnnouncer';
import {
  clearSelection,
  runCollisionCheck,
  runStemDiagnostic,
  runTreeGroundingCheck,
} from '@/state/stores/scene';
import {
  openProjectsView,
  closeProjectsView,
  PROJECTS_VIEW,
  LOADING_CANCEL,
} from '@/state/stores/ui';
import { SOURCE_ERROR, CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';
import { useSwitcherShowcase } from '@/hooks/useSwitcherShowcase';
import { useFeaturedCity } from '@/hooks/useFeaturedCity';
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { attachLoadingReactions } from '@/state/loadingReactions';
import { attachViewUrlReactions } from '@/state/viewUrl';

export function App() {
  useDocumentTitle();
  useSwitcherShowcase();
  useFeaturedCity();
  useShortcutsKey();
  const { submitSource, refreshSource, cancelLoad } = useManifestSource();

  useEffect(() => attachLoadingReactions(), []);
  // Before the boot load can resolve, so the view params in the URL are read
  // ahead of anything that reflects over them.
  useEffect(() => attachViewUrlReactions(), []);

  // CURRENT_SOURCE is written only on a successful load, so this one reaction
  // means "a world committed": drop the stale selection and reveal the city.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) {
      clearSelection();
      closeProjectsView();
    }
  });

  // The landing is full-bleed with no background of its own, so the chrome
  // behind it has to go or its opaque strips show through.
  useSignalEffect(() => {
    document.getElementById('app')?.classList.toggle('cc-showcase', PROJECTS_VIEW.value.visible);
  });

  // App coordinates the projects view; the fetch hook only reports outcomes.
  const dismissView = () => {
    closeProjectsView();
    SOURCE_ERROR.value = null;
  };

  // The cold-boot picker decision runs pre-paint in main.tsx (openBootPickerIfNeeded)
  // so the landing covers the chrome from frame one; App only handles reopens below.

  // A failure reopens the view, dismissible only with a city to fall back to:
  // a failed first pick would otherwise leave the app blank.
  useSignalEffect(() => {
    const err = SOURCE_ERROR.value;
    if (!err) return;
    openProjectsView({
      dismissible: !isEmptyManifest(MANIFEST.peek()),
      prefill: err.prefill,
      error: err.error,
      errorCode: err.code,
    });
  });

  return (
    <>
      <a class="skip-link" href="#app-body">
        Skip to content
      </a>
      <AppHeader
        onSwitchSource={() => openProjectsView({ dismissible: true })}
        // The header owns the control; which read a refresh means in the mode
        // you are in is the fetch layer's call.
        onRefresh={refreshSource}
      />
      <main id="app-body" tabIndex={-1}>
        <LeftSidebar />
        <CenterPane />
        <RightSidebar />
      </main>
      <AppFooter
        onRunCollisionCheck={runCollisionCheck}
        onRunStemDiagnostic={runStemDiagnostic}
        onRunTreeGroundingCheck={runTreeGroundingCheck}
      />
      <ProjectsView onSubmit={(p) => submitSource(p)} onCancel={cancelLoad} onClose={dismissView} />
      <LoadingOverlay
        onCancel={() => {
          // A load with something to go back to registers its own handler; a
          // cold boot has none, so it falls back to the project list.
          const registered = LOADING_CANCEL.peek();
          if (registered) registered();
          else {
            cancelLoad();
            openProjectsView({ dismissible: false });
          }
        }}
      />
      <HljsThemeLink />
      <SelectionAnnouncer />
    </>
  );
}

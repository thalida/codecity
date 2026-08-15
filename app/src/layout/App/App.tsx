// layout/App.tsx — the composition root. CenterPane owns the canvas and boots
// the scene; everything else subscribes to the signals it needs, so App only
// keeps the title in sync and reacts to a world being committed.

import './App.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Router, Route } from 'wouter-preact';

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
import { openProjectsView, closeProjectsView, ON_HOME, LOADING_CANCEL } from '@/state/stores/ui';
import { SOURCE_ERROR, CURRENT_SOURCE, clearSourceUrl } from '@/state/stores/source';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';
import { useSwitcherShowcase } from '@/hooks/useSwitcherShowcase';
import { useHomeBackdrop } from '@/hooks/useHomeBackdrop';
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { attachLoadingReactions } from '@/state/loadingReactions';
import { attachViewUrlReactions } from '@/state/viewUrl';
import { attachRouteHistory, useRouteLocation, useRouteSearch } from '@/state/route';
import { ROUTES } from '@/constants/routes';

export function App() {
  useDocumentTitle();
  useSwitcherShowcase();
  useHomeBackdrop();
  useShortcutsKey();
  const { submitSource, refreshSource, cancelLoad } = useManifestSource();

  // Before anything that reads the URL, so back/forward is never missed.
  useEffect(() => attachRouteHistory(), []);
  useEffect(() => attachLoadingReactions(), []);
  // Before the boot load can resolve, so the view params in the URL are read
  // ahead of anything that reflects over them.
  useEffect(() => attachViewUrlReactions(), []);

  // A successful load, so drop the stale selection. Revealing the city is the
  // source store's navigation to /city, not a second close here.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) clearSelection();
  });

  // The landing is full-bleed with no background of its own, so the chrome
  // behind it has to go or its opaque strips show through.
  useSignalEffect(() => {
    document.getElementById('app')?.classList.toggle('cc-showcase', ON_HOME.value);
  });

  // App coordinates the projects view; the fetch hook only reports outcomes.
  const dismissView = () => {
    closeProjectsView();
    SOURCE_ERROR.value = null;
  };

  // Which route a cold boot belongs on is settled pre-paint in main.tsx
  // (normalizeBootRoute), so the landing covers the chrome from frame one.

  // A failure sends you back to the switcher. Whether you can dismiss it from
  // there is derived: a failed first pick has no city to fall back to.
  useSignalEffect(() => {
    const err = SOURCE_ERROR.value;
    if (!err) return;
    openProjectsView({
      prefill: err.prefill,
      error: err.error,
      errorCode: err.code,
    });
  });

  return (
    <Router hook={useRouteLocation} searchHook={useRouteSearch}>
      <a class="skip-link" href="#app-body">
        Skip to content
      </a>
      <AppHeader
        onSwitchSource={() => openProjectsView()}
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
      <Route path={ROUTES.HOME}>
        <ProjectsView
          onSubmit={(p) => submitSource(p)}
          onCancel={cancelLoad}
          onClose={dismissView}
        />
      </Route>
      <LoadingOverlay
        onCancel={() => {
          // A load with something to go back to registers its own handler; a
          // cold boot has none, so it falls back to the project list.
          const registered = LOADING_CANCEL.peek();
          if (registered) registered();
          else {
            // Nothing to go back to: clearSourceUrl goes home, which IS the
            // list, so the URL stops describing the load just called off.
            cancelLoad();
            clearSourceUrl();
          }
        }}
      />
      <HljsThemeLink />
      <SelectionAnnouncer />
    </Router>
  );
}

// layout/App.tsx — the composition root: it wires the routes and the reactions
// that outlive any one of them, and nothing else. Each view owns its own
// layout, including where the city canvas goes.

import './App.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Router, Route, Switch, Redirect } from 'wouter-preact';

import { HomeView } from '@/views/HomeView/HomeView';
import { CityView } from '@/views/CityView/CityView';
import { HljsThemeLink } from '@/components/HljsThemeLink/HljsThemeLink';
import { SelectionAnnouncer } from '@/components/SelectionAnnouncer/SelectionAnnouncer';
import { clearSelection } from '@/state/stores/scene';
import { goHome, LOADING_CANCEL } from '@/state/stores/ui';
import { SOURCE_ERROR, CURRENT_SOURCE, clearSourceUrl } from '@/state/stores/source';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';
import { useHomeBackdrop } from '@/hooks/useHomeBackdrop';
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { attachLoadingReactions } from '@/state/loadingReactions';
import { attachViewUrlReactions } from '@/state/viewUrl';
import { attachRouteHistory, useRouteLocation, useRouteSearch } from '@/state/route';
import { ROUTES } from '@/constants/routes';

export function App() {
  useDocumentTitle();
  useHomeBackdrop();
  useShortcutsKey();
  const { submitSource, refreshSource, cancelLoad } = useManifestSource();

  // Before anything that reads the URL, so back/forward is never missed.
  useEffect(() => attachRouteHistory(), []);
  useEffect(() => attachLoadingReactions(), []);
  // Before the boot load can resolve, so the view params in the URL are read
  // ahead of anything that reflects over them.
  useEffect(() => attachViewUrlReactions(), []);

  // A successful load, so drop the stale selection. Showing the city is the
  // source store's navigation to /city, not a second thing to coordinate here.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) clearSelection();
  });

  // A failure sends you back to the switcher, carrying what to say about it.
  useSignalEffect(() => {
    const err = SOURCE_ERROR.value;
    if (!err) return;
    goHome({ prefill: err.prefill, error: err.error, errorCode: err.code });
  });

  const cancelLoadFromCity = () => {
    // A load with something to go back to registers its own handler; one with
    // nothing to go back to leaves the URL describing what it just called off.
    const registered = LOADING_CANCEL.peek();
    if (registered) registered();
    else {
      cancelLoad();
      clearSourceUrl();
    }
  };

  return (
    <Router hook={useRouteLocation} searchHook={useRouteSearch}>
      <Switch>
        <Route path={ROUTES.HOME}>
          <HomeView onSubmit={(p) => submitSource(p)} onCancel={cancelLoad} />
        </Route>
        <Route path={ROUTES.CITY}>
          <CityView
            onSwitchSource={() => goHome()}
            onRefresh={refreshSource}
            onCancelLoad={cancelLoadFromCity}
          />
        </Route>
        <Route>
          <Redirect to={ROUTES.HOME} replace />
        </Route>
      </Switch>
      <HljsThemeLink />
      <SelectionAnnouncer />
    </Router>
  );
}

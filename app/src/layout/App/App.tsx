// layout/App.tsx — the composition root: the routes, and the few reactions
// that outlive any one of them. Each view owns its own layout, its own hooks,
// and the canvas it mounts.

import './App.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Router, Route, Switch, Redirect } from 'wouter-preact';

import { HomeView } from '@/views/HomeView/HomeView';
import { CityView } from '@/views/CityView/CityView';
import { goHome } from '@/state/stores/ui';
import { SOURCE_ERROR } from '@/state/stores/source';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useManifestSource } from '@/hooks/useManifestSource';
import { attachLoadingReactions } from '@/state/loadingReactions';
import { attachRouteHistory, useRouteLocation, useRouteSearch } from '@/router/location';
import { ROUTES } from '@/router/paths';

export function App() {
  // The title spans both routes; everything a single view needs is mounted by
  // that view.
  useDocumentTitle();
  useManifestSource();

  // Before anything that reads the URL, so back/forward is never missed.
  useEffect(() => attachRouteHistory(), []);
  useEffect(() => attachLoadingReactions(), []);

  // A failure sends you back to the landing, carrying what to say about it.
  useSignalEffect(() => {
    const err = SOURCE_ERROR.value;
    if (!err) return;
    goHome({ prefill: err.prefill, error: err.error, errorCode: err.code });
  });

  return (
    <Router hook={useRouteLocation} searchHook={useRouteSearch}>
      <Switch>
        <Route path={ROUTES.HOME}>
          <HomeView />
        </Route>
        <Route path={ROUTES.CITY}>
          <CityView />
        </Route>
        <Route>
          <Redirect to={ROUTES.HOME} replace />
        </Route>
      </Switch>
    </Router>
  );
}

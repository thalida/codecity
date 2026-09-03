// app/App.tsx — the composition root: the routes, and the few reactions
// that outlive any one of them. Each view owns its own layout, its own hooks,
// and the canvas it mounts.

import './App.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Router, Route, Switch, Redirect } from 'wouter-preact';

import { HomeView } from '@/features/home/HomeView';
import { CityView } from '@/features/city/CityView';
import { SOURCE_ERROR } from '@/state/source';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import { usePublishSourceToUrl } from '@/router/cityUrl';
import {
  navigate,
  attachRouteHistory,
  useRouteLocation,
  useRouteSearch,
  ROUTES,
} from '@/router/location';

/** The provider shell. Everything a single view needs is mounted by that view;
 *  what is here spans both routes. */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes />
    </QueryClientProvider>
  );
}

function Routes() {
  // The open project, reflected into the URL. Mounted, not a module effect: it
  // navigates, and a navigation on import fires on any import reaching it.
  usePublishSourceToUrl();

  // Before anything that reads the URL, so back/forward is never missed.
  useEffect(() => attachRouteHistory(), []);

  // A failure sends you back to the landing, which reads SOURCE_ERROR itself to
  // explain what happened.
  useSignalEffect(() => {
    if (SOURCE_ERROR.value) navigate(ROUTES.HOME);
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

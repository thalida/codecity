// App.tsx — the composition root: the focused project, the routes, and the few
// reactions that outlive any one of them. The session is created here and
// provided to everything below, so the chrome reads one project rather than a
// global. A side-by-side view would create several and provide one per column.

import './App.css';
import { useEffect, useMemo } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Router, Route, Switch, Redirect } from 'wouter-preact';

import { HomeView } from '@/views/HomeView/HomeView';
import { CityView } from '@/views/CityView/CityView';
import { CitySession } from '@/state/city/session';
import { CityProvider } from '@/state/city/context';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useCityLoader } from '@/state/city/loader';
import { attachUrlBinding } from '@/router/urlBinding';
import { isDebugMode } from '@/utils/debugMode';
import { navigate, attachRouteHistory, useRouteLocation, useRouteSearch } from '@/router/location';
import { ROUTES } from '@/router/paths';

export function App() {
  // One project, for as long as the app is up. Everything below reads it
  // through the provider; nothing reads it from a module.
  const session = useMemo(() => new CitySession(), []);
  useEffect(() => () => session.dispose(), [session]);

  // Before anything that reads the URL, so back/forward is never missed.
  useEffect(() => attachRouteHistory(), []);
  // The URL describes THIS session: one adapter, pointed at one project.
  useEffect(() => attachUrlBinding(session), [session]);

  return (
    <CityProvider session={session}>
      <Router hook={useRouteLocation} searchHook={useRouteSearch}>
        <AppRoutes session={session} />
      </Router>
    </CityProvider>
  );
}

// Inside the provider, so everything it mounts can read the session it belongs
// to rather than being handed pieces of it.
function AppRoutes({ session }: { session: CitySession }) {
  useDocumentTitle();
  useCityLoader(session);

  useEffect(() => session.progress.attachOverlayDriver(), [session]);

  // Debug-only README screenshot capture, when opened with ?shot=<name>.
  // Imported dynamically so the harness never ships in a normal session.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('shot') || !isDebugMode()) return;
    void import('@/city/capture/captureHarness').then((m) => m.initCaptureHarness(session));
  }, [session]);

  // A failure sends you back to the landing, which reads the error itself to
  // explain what happened.
  useSignalEffect(() => {
    if (session.source.error.value) navigate(ROUTES.HOME);
  });

  return (
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
  );
}

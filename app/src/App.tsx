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
import { CitySession } from '@/city/session/session';
import { CityProvider } from '@/city/CityProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLiveUpdates } from '@/city/session/loader';
import { useServerData } from '@/state/stores/serverData';
import { attachUrlBinding } from '@/router/urlBinding';
import { attachRecents } from '@/state/stores/recents';
import { SessionChrome } from '@/state/cityChrome';
import { isDebugMode } from '@/utils/debugMode';
import { navigate, attachRouteHistory, useRouteLocation, useRouteSearch } from '@/router/location';
import { ROUTES } from '@/router/paths';

export function App() {
  // The city you opened, for as long as the app is up: the one with chrome
  // around it. Everything below reads it through the provider.
  const session = useMemo(() => new CitySession({ chrome: new SessionChrome() }), []);
  useEffect(() => () => session.dispose(), [session]);

  // Before anything that reads the URL, so back/forward is never missed.
  useEffect(() => attachRouteHistory(), []);
  // The URL describes THIS session: one adapter, pointed at one project.
  useEffect(() => attachUrlBinding(session), [session]);
  // What it opens is what "recent" means; the backdrop's session does not.
  useEffect(() => attachRecents(session), [session]);

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
  useServerData();
  useLiveUpdates(session);

  useEffect(() => session.progress.attachOverlayDriver(), [session]);

  // Debug-only ?shot=<name> capture, imported dynamically so the harness
  // never ships in a normal session.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('shot') || !isDebugMode()) return;
    void import('@/city/scene/debug/capture/captureHarness').then((m) =>
      m.initCaptureHarness(session)
    );
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

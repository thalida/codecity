// main.tsx — Entry point. Pre-paint synchronous work runs here (before
// the first render) then hands off to <App /> which kicks off the async
// boot flow (manifest streaming, scene init) in its useEffect.

import { render } from 'preact';
import './styles/index.css';
// Sets data-cc-* from the persisted theme before Preact mounts, so there's
// no flash (persistedSignal hydrates synchronously).
import '@/state/settings/values/theme';
import { normalizeBootRoute } from '@/router/location';
import { App } from '@/App';

// Settle the route BEFORE the first render so the first paint is already the
// right one: no chrome flash behind the landing, no landing over a deep link.
normalizeBootRoute();

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}

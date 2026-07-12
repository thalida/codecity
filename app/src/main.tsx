// main.tsx — Entry point. Pre-paint synchronous work runs here (before
// the first render) then hands off to <App /> which kicks off the async
// boot flow (manifest streaming, scene init) in its useEffect.

import { render } from 'preact';
import './styles/index.css';
// Applies the persisted accent/surface theme to <html> before the first
// render (no flash). persistedSignal hydrates synchronously, so the module's
// effect sets data-cc-* before Preact mounts.
import '@/state/stores/settings/theme';
import { App } from '@/layout/App/App';

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}

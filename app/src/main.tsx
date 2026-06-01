// main.tsx — Entry point. Pre-paint synchronous work runs here (before
// the first render) then hands off to <App /> which kicks off the async
// boot flow (manifest streaming, scene init) in its useEffect.

import { render } from 'preact';
import './styles.css';
import { App } from '@/layout/App';

// Re-export so tests that import from '@/main' continue to resolve.
export { applyPendingTitle } from './utils/pendingTitle';
export { EMPTY_MANIFEST } from './constants/manifest';

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}

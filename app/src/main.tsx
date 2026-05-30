// main.tsx — Entry point. Hands off to App, which kicks the existing
// boot flow inside its useEffect.

import { render } from 'preact';
import './styles.css';
import { App } from './views/shell/App';

// Re-export so tests that import from '@/main' (e.g. tests/views/pendingTitle.test.ts)
// continue to resolve without changes during Phase 2.
export { applyPendingTitle, EMPTY_MANIFEST } from './boot';

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}

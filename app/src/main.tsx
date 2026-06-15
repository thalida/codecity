// main.tsx — Entry point. Pre-paint synchronous work runs here (before
// the first render) then hands off to <App /> which kicks off the async
// boot flow (manifest streaming, scene init) in its useEffect.

import { render } from 'preact';
import './styles/index.css';
import { App } from '@/layout/App';

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}

// main.tsx — Entry point. Pre-paint synchronous work runs here (before
// the first render) then hands off to <App /> which kicks off the async
// boot flow (manifest streaming, scene init) in its useEffect.

import { render } from 'preact';
import './styles/index.css';
// Applies the persisted accent/surface theme to <html> before the first
// render (no flash). persistedSignal hydrates synchronously, so the module's
// effect sets data-cc-* before Preact mounts.
import '@/state/stores/settings/theme';
import { openBootPickerIfNeeded } from '@/state/bootView';
import { App } from '@/layout/App/App';

// Decide the cold-boot picker BEFORE the first render so the full-page landing
// covers the chrome from frame one (no chrome flash).
openBootPickerIfNeeded();

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}

// Debug-only README screenshot capture: only when opened with ?shot=<name>.
// Dynamically imported so the harness never ships in a normal session.
if (new URLSearchParams(window.location.search).has('shot')) {
  void import('@/city/capture/captureHarness').then((m) => m.initCaptureHarness());
}

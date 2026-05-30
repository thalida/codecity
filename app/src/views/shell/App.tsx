// App.tsx — Phase 2 placeholder root component. Renders the static
// layout shell that index.html used to declare, then kicks off the
// existing vanilla boot flow inside useEffect so behavior is identical
// to pre-Phase-2 main.ts. Phase 3 replaces these slot divs with native
// Preact components.

import { useEffect } from 'preact/hooks';
import { bootApp } from '../../boot';

export function App() {
  useEffect(() => {
    // bootApp finds #city via getElementById; the canvas below is in
    // the DOM by the time this effect runs (Preact has committed the
    // render synchronously before useEffect fires).
    bootApp();
  }, []);

  return (
    <>
      <header id="app-header">
        <div id="app-header-left"></div>
        <div id="app-title"></div>
        <div id="app-header-right"></div>
      </header>
      <main id="app-body">
        <div id="tree-sidebar"></div>
        <div id="center-pane">
          <canvas id="city"></canvas>
        </div>
        <div id="sidebar"></div>
      </main>
      <footer id="app-footer"></footer>
      <div id="source-picker-root" style={{ display: 'none' }}></div>
      <div id="loading-overlay-root" style={{ display: 'none' }}></div>
    </>
  );
}

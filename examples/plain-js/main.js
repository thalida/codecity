// A working city in a page with no framework, no build step of its own, and no
// state library. Everything it needs comes from @codecity/city.
//
// This example is a TEST, not a demo: if rendering a city, showing what it is
// doing, reacting to a selection or restoring a link needs anything from
// packages/app, that thing is in the wrong package — and it shows up here,
// rather than in review.

import { createCity, CityLifecycle } from '@codecity/city';

const canvas = document.getElementById('city');
const statusEl = document.getElementById('status');
const fillEl = document.getElementById('fill');
const selectionEl = document.getElementById('selection');

// 1. Make one. The api base is the only thing it needs to know about the host.
const city = await createCity(canvas, { baseUrl: '/api' });

// 2. Draw what it is doing. ONE value, readable at any moment — this function
//    would give the right answer called from anywhere, at any time, including
//    before it was ever subscribed.
function renderStatus() {
  const { lifecycle, fetching, phase, fraction } = city.status;
  const parts = [phase ?? lifecycle];
  // Two axes: a city can be up AND still have more coming, which is a real
  // city on screen with its git history still streaming.
  if (lifecycle === CityLifecycle.Ready && fetching) parts.push('(still loading history)');
  if (lifecycle === CityLifecycle.Error) parts.push(String(city.status.error));
  statusEl.textContent = parts.join(' ');
  fillEl.style.width = fraction == null ? '0' : `${Math.round(fraction * 100)}%`;
}

// 3. Re-render when something moves. One subscription, and it says what moved,
//    so a bigger app can skip the work it does not need.
city.onChange((change, { selection }) => {
  if (change.statusChanged) renderStatus();
  if (change.selectionChanged) {
    selectionEl.textContent = selection
      ? `${selection.kind}: ${selection.file?.path ?? selection.dir?.path ?? ''}`
      : 'nothing selected';
  }
  // 5. The view state is one plain value, so a deep link is two lines.
  if (change.selectionChanged || change.timelineChanged) {
    const view = encodeURIComponent(JSON.stringify(city.getViewState()));
    history.replaceState(null, '', `?src=${encodeURIComponent(src)}&view=${view}`);
  }
});

renderStatus();

// 4. Show a repo. The city fetches it and reports the whole way.
const params = new URLSearchParams(location.search);
const src = params.get('src') ?? 'https://github.com/thalida/codecity';
await city.loadSource({ src });

// …and put the reader back where a link says they were.
const view = params.get('view');
if (view) city.setViewState(JSON.parse(decodeURIComponent(view)));

// 6. Stay on the newest version of it. The city polls a cheap signature and
//    re-applies only when the repo actually moves — a refresh, not a load, so
//    buildings do not drop to placeholder heights and back on every save.
const stopWatching = city.watchSource({ intervalSeconds: 10 });
addEventListener('beforeunload', () => {
  stopWatching();
  city.dispose();
});

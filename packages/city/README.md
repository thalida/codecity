# @codecity/city

**A repository, rendered as a city you can fly through.** Files are buildings,
directories are streets, commits are trees. Give it a canvas and a repo; it
fetches, builds, and tells you what it is doing while it does.

Everything about it is a prop, and everything it draws is replaceable.

## The whole of it

```tsx
import { City } from '@codecity/city/preact';

<City src="https://github.com/preactjs/preact" />;
```

That renders a city, fetches the repo, streams the scan, and shows a hover
tooltip. Nothing else is required.

## What to show

`src` and `branch` name a repo; changing either loads the next one. `exclude`
changes the QUESTION rather than the repo, so it re-scans in place and keeps the
city you are looking at. `manifest` shows one you already have, instead of
fetching.

```tsx
<City src="/path/to/repo" branch="main" exclude={['vendor']} watchSeconds={5} />
```

## Where the reader is

`viewState` and `onViewStateChange` are a controlled pair: what is selected, and
where the history scrubber sits. Reflect it into a URL and a link restores the
view.

```tsx
const [view, setView] = useState<CityViewState>({});
<City src={src} viewState={view} onViewStateChange={setView} />;
```

The component drops a `viewState` that only echoes what the city just reported,
so feeding every change straight back is safe.

## What happened

`onStatus` is one value covering every kind of work — resolving, cloning,
scanning, reading history, building — so a readout renders off one thing rather
than folding four event streams.

```tsx
<City src={src} onStatus={(s) => setPhase(s.phase)} onError={console.error} />
```

`onSelect`, `onHover`, `onPick` and `onFocusRequest` report what the reader did.
`onReady` hands back the instance for what props cannot express.

## Reading it from your own chrome

Anything inside `<City>` is rendered over the canvas, inside its provider, so it
can ask the city what is happening without being handed anything:

```tsx
import { City, useCitySelection, useCityStatus } from '@codecity/city/preact';

function Details() {
  const selected = useCitySelection();
  return selected ? <aside>{selected.file.path}</aside> : null;
}

<City src={src}>
  <Details />
</City>;
```

Hooks: `useCity`, `useCityStatus`, `useCityManifest`, `useCitySelection`,
`useCityHover`, `useCityTimeline`, `useScrub`. Each takes an optional explicit
city, so two on one page never collide.

## Replacing what it draws

`components` swaps a piece for your own; `null` removes it. The defaults are
exported, so you can wrap one rather than rebuild it.

```tsx
import { City, DefaultCityTooltip, type CityTooltipProps } from '@codecity/city/preact';

function MyTooltip({ target }: CityTooltipProps) {
  return <DefaultCityTooltip target={target} />;
}

<City src={src} components={{ Tooltip: MyTooltip }} />;
<City src={src} components={{ Tooltip: null }} />;
```

## Adding to the scene

An extension is a function handed the scene's context, returning something that
ticks and disposes with the city:

```tsx
const marker: CityExtension = (ctx) => {
  const mesh = new THREE.Mesh(geometry, material);
  ctx.scene.add(mesh);
  return { tick: (dt) => void mesh.rotateY(dt), dispose: () => mesh.geometry.dispose() };
};

<City src={src} extensions={[marker]} />;
```

## Saving a session

`getSnapshot()` returns what it shows, how it is set up, and where the reader
is, as one value. `loadSnapshot()` puts it back — using the manifest it was
given rather than re-fetching, so a saved city is the city that was saved.

## Without a framework

`@codecity/city` is the core and imports no framework. `City.create(canvas)`
builds one; the class is the same surface the component drives.

```ts
import { City } from '@codecity/city';

const city = await City.create(canvas);
await city.loadSource({ src: '/repo' });
city.onStatus((s) => console.log(s.phase));
```

`preact` is an optional peer dependency, needed only for `@codecity/city/preact`.

## Testing against it

`@codecity/city/testing` ships the fixtures and stand-ins — `fakeCity`,
`EMPTY_MANIFEST`, a WebGL renderer jsdom can run — so a consumer's tests do not
rebuild them. `@codecity/city/testing/three` holds the renderer stubs behind
their own door, since a `vi.mock('three')` factory cannot await a barrel that
imports three.

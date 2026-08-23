# `city/` — one city, whole

Everything a city IS lives here: what it is showing, how far its load has got,
the history it is scrubbed through, what it looks like, and the Three.js scene
drawing it. Two cities on screen are two `CitySession`s and nothing else.

Three things, and the split is the point: what a city IS, what DRAWS it, and
the component that puts one on a page.

```
City.tsx              a <canvas> rendering a session
CityProvider.tsx      how the chrome around it finds which session it is looking at

session/              what a city is
  session.ts            CitySession — it, and everything it is made of
  config.ts             CityConfig — what it looks like, per session
  stores/               its manifest, source, progress and timeline
  loader.ts             fetching it: the scan, its cancel, the live poll
  timelineMode.ts       scrubbing it: entering, moving, leaving
  commands.ts           the verbs the chrome sends its scene
  settings/             the fields that config is made of: what a city HAS
  rebuildOnSave.ts      a Save to that config → this city re-packs

scene/                what draws it
  index.ts              createCityScene(canvas, session) — the composer
  build.ts              what the last apply MADE of it, and how to apply another
  types/                SceneContext, CityScene, CityChrome
  components/           what is IN the city: buildings, streets, trees, gem…
  layout/               where they go: the packer, on a worker
  render/               camera, post-processing, frame loop
  interaction/          picker, pointer and keyboard, tooltip
  scrub/                replaying history across it
  constants/ utils/ debug/
```

## The boundary

A city never reaches for the app. It asks, through `CityChrome`
(`types/index.ts`): whether something else holds the keyboard, and to show a
node's details or get out of the way. `state/cityChrome.ts` is codecity's
answer; a session given none asks for nothing, which is what the landing's
backdrop gets.

Nothing here reads the settings panel's signals either. Every visual value comes
from `session.config`, seeded from the panel and overridable per city — the two
workers take a snapshot of it, since they cannot read a signal at all.

What it does use from the app, deliberately:

|                           |                                                             |
| ------------------------- | ----------------------------------------------------------- |
| `api/*`                   | the backend                                                 |
| `state/stores/excludes`   | folders you hid in this repo, which outlive any one session |
| `state/stores/recents`    | a label for the overlay before the server sends one         |
| `state/stores/serverData` | the server's config and its discover list                   |
| `state/settings/fields/*` | **types only**, plus `config.ts` seeding from them          |

The app, in turn, reacts to a city rather than being called by it:
`attachUrlBinding` (router) reflects and follows the URL, `attachRecents`
records what you opened, and `attachConfigReactions` re-packs on a Save.

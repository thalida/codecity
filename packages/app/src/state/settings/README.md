# Settings

Five machinery files, and under them the settings those files operate on. The
top level is all piping — no file here holds a value. Each is one stage of a
setting's life:

```
schema.ts      declare it   what a field IS: kind, default, label, tip, bounds
drafts.ts      edit it      staged changes, behind the Save button
reactions.ts   apply it     a committed change → rebuild or refresh the scene
indicators.ts  report it    how many differ from default → the dirty dot
transfer.ts    move it      settings out to a file, and a file back in
values/        the settings themselves: the stores, and what they hold
```

`values/city.ts` is generated from the city's own `CITY_FIELDS` rather than
written: the package declares which stores exist, and the app derives a signal
per store, the object a city is handed, and the landing backdrop's variant of it
from that one list. The other three files are settings the app owns outright,
so they declare their own fields.

## The schema is the single source

A settings store is a **flat map of field definitions**. Each key carries what
the field intrinsically _is_ — kind, default, label, tip, bounds or options —
independent of where it gets shown.

`settingSignal()` derives the persisted default object from those `default`s,
hands it to `persistedSignal` (so persistence, hydration, diff-vs-default and
drafts behave as they always did), and registers the field map so the controls
panel can look a field up by `(store, key)`.

The persisted **type** comes from the same map via `ConfigOf<>`, so the defaults
and the config type have one source. No separate default object, no
hand-written interface to drift out of step.

**Arrangement is not here.** Which section or subgroup a field sits in, its
nesting and its order all live in the controls UI layer
(`views/CityView/panes/ControlsPane/sectionConfigs/`). A field declares what it
is; the panel decides where it goes.

Select options are declared here rather than imported from the view's
`SelectField`, so `state/` stays view-independent. The option array a store
declares is structurally identical to what the widget renders.

## Validation on hydrate

A hydrated value is checked against its definition before it reaches the scene:
numerics must be finite and are clamped to `[min, max]`; a `RangePair` must be a
two-number array with each end clamped; a toggle must be boolean; a select must
be a declared option. Anything else (a `Color` string, `TierWidths`, `HueMap`)
survives only if its basic shape matches the default. Whatever fails falls back
to the default, and the sanitized value is re-persisted — but only when
something was actually off.

This guards against stale or tampered localStorage: a Number field cleared to 0
below its `min` gives a 0 floor height and NaN geometry, and a select option
that has since been renamed would otherwise flow straight into the renderer.

## Two registries, deliberately different sizes

`persist.ts` knows every persisted signal. The settings panel knows a **narrower**
set: every `settingSignal` store, plus a few hand-registered ones such as
`SYNTAX_THEME` (a plain `persistedSignal`). Reset-all, draft staging and the
non-default count iterate only that narrower set, so non-settings persisted
state — recents, sidebar width and collapse — is never reset or counted by the
settings UI.

Stores can also be marked **write-through**: their widgets apply on change and
bypass the draft layer entirely. The autosave tabs (Updates, Appearance) use
this because their settings are cheap and want instant feedback.

## Drafts

Storage shape is `Map<storeRef, Map<key | null, value>>`. Scalar-valued signals
have no sub-key, so `key` is `null` and the inner map holds at most one entry.

Widgets read `getEffective()` and write `setDraft()`. Save calls `commit()`,
which flushes every draft into its signal and lets the existing persist and
reaction effects fire. Discard clears drafts without touching signals. A reload
drops them: they are in-memory only, the standard unsaved-changes pattern.

`DRAFTS_REV` is a monotonic counter bumped on every draft mutation. Components
read `DRAFTS_REV.value` to make `getEffective` lookups reactive: pair it with a
`store.value` read in the same render and the component re-renders on either a
draft change or an underlying signal change.

`commit()` snapshots the entries before clearing `_drafts`, so any synchronous
signal effect that re-reads `getEffective` sees the freshly committed value
rather than the draft that is on its way out.

## Reactions

Two string-valued computed signatures drive one effect each:

```
REBUILD_SIGNATURE → scheduleRebuild   full applyManifest
REFRESH_SIGNATURE → flagRefresh       the 'rebuilding' status flash only
```

Both are **generated** from each field's `route` metadata
(`ChangeRoute.Rebuild | Refresh | Live`) by `routeSignature()`. There are no
hand-kept per-store key lists to fall behind. A signature changes if and only if
a field with that route changes, so the wrong effect never fires, and `Live`
fields flip neither — they are read fresh per frame (gem and firefly animation)
or driven elsewhere (live-update polling).

The material and uniform refresh for a refresh-class Save is **reactive**, not
something `reactions.ts` performs: the controls write the store on Save, and each
component's own settings effect (plus postFx's `BLOOM` effect) re-applies its
uniforms. The reaction's only job is the brief `rebuilding` flash so the Save
visibly registers, held for a minimum dwell and skipped if a real rebuild is
already in flight, since `applyManifest` owns the final status then.

A rebuild through this path always invalidates the layout cache. The manifest
did not change but a layout-affecting value did, so `reuseLayoutFrom` would skip
the recompute and the change would have no visible effect. Live-update polls
never call `scheduleRebuild`, so they keep using the cache.

Each effect must track **only** its signature computed, so the imperative work —
which writes build status — runs inside `untracked()`. Otherwise the effect
subscribes to whatever that work reads and re-fires on its own writes.

## Transfer

`transfer.ts` writes settings to a JSON file and reads one back. Both directions
are all-or-nothing only if you make them so: you pick what goes into the file,
and pick again what comes out of it.

Everything that can travel is a **part**: a key, a family, a `read()` and a
`write()`. A settings store is one kind of part; the open repo's hidden paths are
another. Past that interface nothing tells them apart, so building, reading and
applying a file are each one loop with no special cases in them. The next thing
that has to travel is a new part, not another branch through all three.

A **family** is a key in the file, one per menu these settings live in: `render`
(the controls pane), `appearance` (the appearance menu) and `scan` (the scan
menu). Under a family, a part's key is its own — for a store, the stable string
`persist.ts` keys localStorage by.

A store part carries its **whole value**, defaults included. The file is a
snapshot of how things look right now, not a list of what was changed away from
stock, so an import reproduces a look exactly without depending on what the
defaults happened to be that day. Writing one back **replaces** it: defaults
first, then the file over the top, and the store's staged drafts are dropped
since the write goes straight to the signal, nowhere near the pane's Save. A part
the file never names is left alone.

The excludes part carries the open repo's hidden paths plus the `src` and
`branch` they belong to. That src is not decoration: it is the key the list gets
filed under on import. An exclude list is about one repo, so it is stored against
that repo and is waiting there the next time you open it, whichever city you were
looking at when you imported. Nothing navigates, and no other repo's list is
touched. The stored key is a one-way hash of the src, which is why the file
carries the src itself and re-derives the key on the far side.

Every part can also say whether writing a given value would land on something
other than what is there now. Asked with no value, that is "does this differ from
its default", which is what marks a row as yours on the way out; asked with the
file's value, it is "would this overwrite something of mine", which is what marks
a row as a change on the way in. One question, two baselines, one dot.

Importing needs a **catalogue** — the parts the app is willing to accept — and it
is the catalogue, not the settings registry, that decides. A hand-edited file
naming a real store that deliberately never travels (the auto-refresh interval)
resolves to nothing. A file also states `kind` and `version` up front and is
refused outright if either is wrong, rather than half-applied. Within a file that
does load, each value is still checked against its field: out-of-bounds numbers
clamp, anything the schema cannot use is skipped and reported.

Which parts are grouped under which name is **not** here, for the same reason
arrangement isn't: the controls layer owns that
(`views/CityView/chrome/CityFooter/transferGroups.ts`). Render's groups are read
off the pane's own sections so the two cannot drift, and that file also declares
`NON_TRANSFERABLE`.

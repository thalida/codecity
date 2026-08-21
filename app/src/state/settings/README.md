# Settings

Five machinery files and the fields they operate on. Each file is one stage of a
setting's life:

```
schema.ts      declare it   what a field IS: kind, default, label, tip, bounds
drafts.ts      edit it      staged changes, behind the Save button
reactions.ts   apply it     a committed change → rebuild or refresh the scene
indicators.ts  report it    how many differ from default → the dirty dot
transfer.ts    move it      settings out to a file, and a file back in
fields/        the settings themselves, one file per group
```

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
take the same `TransferSelection`, so neither is all-or-nothing: you pick what
goes into the file, and pick again what comes out of it.

The file has one key per **family**: `render` (the controls pane), `appearance`
(the appearance menu) and `scan` (the scan menu). Adding one is
a line in `TransferFamily`; everything else loops over `TRANSFER_FAMILIES`.

Under a family, a key is a store's **persisted name** — the same stable string
`persist.ts` keys localStorage by — and its value is that store's **whole
value**, defaults included. The file is a snapshot of how things look right now,
not a list of what was changed away from stock, so an import reproduces a look
exactly without depending on what the defaults happened to be that day.

An import **replaces** each ticked store: defaults first, then the file over the
top. A store the file never names is left alone. Everything is offered every
time, whether or not it differs from stock.

`scan` carries one reserved key, `EXCLUDES`, holding the open repo's hidden
paths together with the `src` and `branch` they belong to. Those are not
decoration: `src` is the key the list gets filed under on import. An exclude
list is about one repo, so it is stored against that repo and is waiting there
the next time you open it, whichever city you happened to be looking at when you
imported. Nothing here navigates, and no other repo's list is touched. A list
exported with no repo open names none, and is filed nowhere.

The stored key is a one-way hash of the src, which is why the file carries the
src itself rather than the key: the hash is re-derived on the far side, so a
build that changes how it hashes does not strand every existing file.

A file states `kind` and `version` up front and is refused outright if either is
wrong, rather than half-applied. Within a file that does load, each value is
still checked against its field: out-of-bounds numbers clamp, anything the
schema cannot use at all is skipped and reported.

Which stores are grouped under which name is **not** here, for the same reason
arrangement isn't: the controls layer owns that
(`views/CityView/chrome/CityFooter/transferGroups.ts`). Render's groups are read
off the pane's own sections so the two cannot drift, and that file also declares
`NON_TRANSFERABLE` — settings that deliberately never travel, such as the
auto-refresh interval, which describes your machine rather than a look.

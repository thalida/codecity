# Settings

Four machinery files and the fields they operate on. Each file is one stage of a
setting's life:

```
schema.ts      declare it   what a field IS: kind, default, label, tip, bounds
drafts.ts      edit it      staged changes, behind the Save button
reactions.ts   apply it     a committed change → rebuild or refresh the scene
indicators.ts  report it    how many differ from default → the dirty dot
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

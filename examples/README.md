# Examples

Two hosts for the same package, and the reason they exist.

```
plain-js/   a working city in a page with no framework and no build step
vue/        the same city as a Vue single-file component
```

The package ships one adapter itself, `@codecity/city/preact`, on its own
subpath — the way zustand ships `zustand/vanilla` beside `zustand/react`.
`preact` is an OPTIONAL peer dependency, so a host that never imports that
subpath never installs it, and the core entry pulls none of it. `vue/City.vue`
is what a second adapter looks like, and the reason it is short is that there is
nothing framework-shaped left to do.

They are not demos. They are the measure the package is designed against: a
host renders a city, shows what it is doing, reacts to a selection, restores a
link and stays on the newest version of the repo, **importing only
`@codecity/city`**. If any of that needs something from
`packages/app`, that thing is in the wrong package — and it shows up here rather
than in review.

The Vue one is deliberately short. What it does not contain is the point: no
store, no event reducer, no status vocabulary of its own, no reduction over
progress events. A framework adapter for a package like this should cost a ref,
a watch and a dispose, the way `@monaco-editor/react` and `vue-codemirror` do.

## What holds them honest

Neither is run by CI — they have no build of their own, on purpose, because the
moment an example needs a toolchain it stops being readable as an example.
What IS run is `packages/city/tests/publicApi.test.ts`, which performs the same
sequence as `plain-js/main.js` importing only the package's entry point. A
capability that quietly needs a deep path fails there.

## Running plain-js

It needs a server for `/api`, which is this repo's own:

```
just dev
```

then serve `examples/plain-js/` against that origin. The import of
`@codecity/city` resolves through your bundler; there is no build step in the
example itself.

# Vendored Monaco themes

These `*.json` files are Monaco `IStandaloneThemeData` theme definitions
vendored from [monaco-themes](https://github.com/brijeshb42/monaco-themes)
(MIT license), themselves ported from the original TextMate themes.

They're vendored (not an npm dependency) because monaco-themes' package
`exports` map does not expose `./themes/*.json`, so a bundler can't import them
directly. Each file is renamed to its codecity setting key (see
`state/stores/settings/syntaxTheme.ts`). The Monaco editor loads them lazily via
`monacoSetup.ts` when a theme is selected.

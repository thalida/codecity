// constants/buildings.ts — Default per-extension building hues.
//
// This is the DEFAULT for the (still user-tunable) BUILDINGS.HUE_EXT_MAP field —
// extracted here so the settings store stays lean. Hue (0–359°) is picked to
// match the standout color of the file's icon in Material Icon Theme: the color
// you see on the file's pill/glyph is the hue the building ramps off in the
// city. When an icon has multiple colors we pick the more distinctive one
// (e.g. Python is yellow+blue → yellow, since blue is overused).
//
// Hues audited against the actual Material Icon Theme SVG fill colors at
// jsdelivr (v5.30.0). Mixed-palette icons (Erlang, Clojure, Python) get the
// more distinctive hue.

// Ad-panel tint shown after a permanent image load/decode failure (sticky).
// Never a UI control — the placeholder color (transient/loading) is tunable in
// BUILDINGS; this failure color is fixed.
export const AD_ERROR_COLOR = '#3a1d1d';

export const DEFAULT_HUE_EXT_MAP: Record<string, number> = {
  // JS family
  '.js': 45, // javascript: #ffca28 amber
  '.mjs': 45,
  '.cjs': 45,
  '.jsx': 187, // react: #00bcd4 cyan
  '.ts': 201, // typescript: #0288d1 blue
  '.tsx': 201, // react_ts: also #0288d1 (TS-themed react)
  '.mts': 201,
  '.cts': 201,
  // Python — pick yellow (blue is the secondary)
  '.py': 52,
  '.pyx': 52,
  '.pyi': 52,
  // Web
  '.html': 19, // html: #e65100 deep orange
  '.htm': 19,
  '.xml': 88, // xml: #8bc34a light green
  '.css': 261, // css: #7e57c2 purple
  '.scss': 340, // sass: #ec407a pink
  '.sass': 340,
  '.less': 201, // less: #0277bd blue (not purple)
  '.vue': 155, // vue: #41b883 green
  '.svelte': 14, // svelte: #ff3e00 orange-red
  // Data / config — `settings` icon (TOML/INI) is blue, not amber.
  '.json': 39, // json: #f9a825 yellow
  '.yaml': 0, // yaml: #ff5252 red
  '.yml': 0,
  // Generic-glyph icons (settings / document / markdown) are all
  // mono-blue in Material — using their glyph color would dump four
  // file types into the already-crowded blue band. Picking
  // low-frequency hues here keeps the colors readable as filenames
  // alone (config amber, parchment, notes green) without contradicting
  // any strong brand identity.
  '.toml': 25, // settings → config amber
  '.ini': 25,
  '.env': 45, // tune: #fbc02d amber
  // Docs
  '.md': 145, // markdown → notes green
  '.markdown': 145,
  '.mdx': 45, // mdx: #ffca28 amber
  '.txt': 65, // document → parchment cream
  '.rst': 65,
  // Languages (icon standout colors)
  '.rb': 4, // ruby: #f44336 red
  '.go': 187, // go: #00acc1 cyan
  '.rs': 14, // rust: #ff7043 deep orange
  '.java': 4, // java: Material glyph is red (#f44336)
  '.kt': 262, // kotlin: gradient peaking purple
  '.kts': 262,
  '.swift': 13, // swift: #ff6e40 orange
  '.c': 201, // c: #0288d1 blue
  '.h': 201,
  '.cpp': 201, // cpp: also #0288d1
  '.cc': 201,
  '.hpp': 201,
  // .cs / .php: Material's glyphs are blue, but the canonical brand
  // colors are purple — and the 200–210 blue band is already crowded
  // with TS / C / C++. Using brand colors here adds variety while
  // staying faithful to the language identity users recognize.
  '.cs': 290, // C# Microsoft purple
  '.php': 237, // PHP indigo
  '.lua': 199, // lua: #4fc3f7/#01579b blues
  '.dart': 4, // dart: Material glyph is red, not teal
  '.scala': 290, // scala: #ba68c8 purple (not red)
  '.pl': 30, // Perl: glyph is mono-blue; push to onion amber (brand-association)
  '.r': 258, // r: #9575cd purple
  '.ex': 4, // elixir: Material glyph is red, not purple
  '.exs': 4,
  '.erl': 95, // Erlang: glyph blue-dominant but crowded; push to sage green
  '.clj': 1, // clojure: mixed warm; dominant #ef5350 red
  '.hs': 39, // haskell: #f9a825 amber (not purple)
  '.zig': 39, // zig: #f9a825 amber
  '.nim': 45, // nim: #ffca28 amber
  // Shells / build — `console` glyph is orange, not green.
  '.sh': 14, // console: #ff7043 orange
  '.bash': 14,
  '.zsh': 14,
  '.fish': 14,
  '.ps1': 199, // powershell: #03a9f4 blue
  // Queries
  '.sql': 45, // database: #ffca28 amber (not teal-blue)
  '.graphql': 340, // graphql: #ec407a pink
  '.gql': 340,
  // Media — image is teal, video is orange, audio is red (NOT purple).
  '.svg': 43, // svg: #ffb300 amber
  '.png': 174, // image: #26a69a teal
  '.jpg': 174,
  '.jpeg': 174,
  '.gif': 174,
  '.webp': 174,
  '.bmp': 174,
  '.ico': 174,
  '.avif': 174,
  '.mp4': 35, // video: #ff9800 orange
  '.webm': 35,
  '.mov': 35,
  '.m4v': 35,
  '.ogv': 35,
  '.mkv': 35,
  '.mp3': 1, // audio: #ef5350 red
  '.wav': 1,
  '.flac': 1,
  '.aac': 1,
  '.m4a': 1,
  '.ogg': 1,
  '.pdf': 1, // pdf: #ef5350 red
  // Archives
  '.zip': 64, // zip: #afb42b olive (not cream)
  '.tar': 64,
  '.gz': 64,
  '.7z': 64,
  '.rar': 64,
  // Diff glyph is mono-blue too; pushing to a green-yellow keeps it
  // semantically "additions" while spacing it from the blue cluster.
  '.diff': 110, // diff → additions green
  '.patch': 110,
  '.log': 64, // log: #afb42b olive
  '.lock': 46, // lock: #ffd54f amber
};

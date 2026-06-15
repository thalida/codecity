// vite-env.d.ts — ambient declarations for Vite-handled non-JS imports.

declare module '*.css';

// ?raw imports — Vite's built-in raw-text loader returns the file contents
// as a plain string. TypeScript doesn't know about this query suffix, so we
// declare it here. Used across city/ for GLSL shader sources (buildings, island, footprint, ad-panels).
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}

// ?url imports — Vite resolves these to the asset's served URL (copying the
// file into the build output). Used by constants/materialIcons.ts to bundle
// the Material Icon Theme SVGs from the npm package.
declare module '*.svg?url' {
  const url: string;
  export default url;
}

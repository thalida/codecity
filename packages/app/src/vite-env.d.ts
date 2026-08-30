// vite-env.d.ts — ambient declarations for Vite-handled non-JS imports.

/// <reference types="vite/client" />

declare module '*.css';

// ?raw — Vite's raw-text loader. TypeScript does not know the query suffix,
// so it is declared here. Used for the city's GLSL shader sources.
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}

// ?url — Vite resolves these to the asset's served URL, copying the file into
// the build. Used to bundle the Material Icon Theme SVGs.
declare module '*.svg?url' {
  const url: string;
  export default url;
}

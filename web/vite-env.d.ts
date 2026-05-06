// vite-env.d.ts — ambient declarations for Vite-handled non-JS imports.

declare module '*.css';

// ?raw imports — Vite's built-in raw-text loader returns the file contents
// as a plain string. TypeScript doesn't know about this query suffix, so we
// declare it here. Used by web/scene/instanced/buildings.ts for GLSL shaders.
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}

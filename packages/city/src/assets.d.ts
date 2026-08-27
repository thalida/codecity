// The package resolves its icons and shaders through the bundler, the same way
// the app does. That makes a Vite-compatible build step part of consuming it.
declare module '*.svg?url' {
  const src: string;
  export default src;
}
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}

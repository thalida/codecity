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
declare module '*.css';

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_DEBUG?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

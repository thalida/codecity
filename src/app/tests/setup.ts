// tests/setup.ts — Global test environment setup for vitest + jsdom.
//
// jsdom does not implement ResizeObserver (it's a browser layout API).
// Stub it so modules that construct a ResizeObserver at init time don't
// throw in the test environment. The stub is a no-op: observe/unobserve
// do nothing, and the callback is never called — layout-dependent
// truncation behaviour is validated in visual/E2E tests, not unit tests.

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

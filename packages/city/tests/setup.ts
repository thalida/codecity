// Global test environment setup for vitest + jsdom.
//
// jsdom does not implement ResizeObserver (it's a browser layout API). Stub it
// so modules that construct one at init time don't throw. The stub is a no-op:
// layout-dependent behaviour is validated in a real browser, not here.

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

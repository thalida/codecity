// dvh is a toolbar's height wrong on this app, because the root never scrolls:
// scrolling a pane retracts the mobile toolbar and dvh doesn't follow, leaving
// the shell above the bottom of the screen. The shell reads a measured height
// instead, so this covers what gets measured and what gets ignored.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackViewportHeight } from '@/state/stores/viewport';

interface FakeViewport {
  height: number;
  scale: number;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  emitResize: () => void;
}

function fakeVisualViewport(height: number, scale = 1): FakeViewport {
  const listeners = new Set<() => void>();
  return {
    height,
    scale,
    addEventListener: (type, fn) => {
      if (type === 'resize') listeners.add(fn);
    },
    removeEventListener: (_type, fn) => listeners.delete(fn),
    emitResize: () => listeners.forEach((fn) => fn()),
  };
}

const install = (vv: FakeViewport | undefined): void => {
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
};

const measuredHeight = () => document.documentElement.style.getPropertyValue('--cc-viewport-h');
const optedIn = () => document.documentElement.classList.contains('cc-has-viewport-h');

describe('trackViewportHeight', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.remove('cc-has-viewport-h');
  });

  afterEach(() => {
    stop();
    install(undefined);
  });

  it('publishes the visible height and opts the shell in', () => {
    install(fakeVisualViewport(740));

    stop = trackViewportHeight();

    expect(measuredHeight()).toBe('740px');
    expect(optedIn()).toBe(true);
  });

  // The toolbar retracting is the whole bug: dvh stays put, this must not.
  it('follows the browser chrome moving', () => {
    const vv = fakeVisualViewport(740);
    install(vv);
    stop = trackViewportHeight();

    vv.height = 800;
    vv.emitResize();

    expect(measuredHeight()).toBe('800px');
  });

  // A pinch shrinks visualViewport to the slice you are looking at. Relaying the
  // shell to that would shrink the app under the gesture.
  it('ignores a pinch-zoom', () => {
    const vv = fakeVisualViewport(740);
    install(vv);
    stop = trackViewportHeight();

    vv.height = 300;
    vv.scale = 2.5;
    vv.emitResize();

    expect(measuredHeight()).toBe('740px');
  });

  // Without a measurement the stylesheet has to fall back to dvh, so the class
  // must never go on by itself.
  it('leaves the shell on its dvh fallback where there is nothing to measure', () => {
    install(undefined);

    stop = trackViewportHeight();

    expect(optedIn()).toBe(false);
    expect(measuredHeight()).toBe('');
  });

  it('stops listening and hands the shell back to dvh on teardown', () => {
    const vv = fakeVisualViewport(740);
    install(vv);

    trackViewportHeight()();

    expect(optedIn()).toBe(false);
    expect(measuredHeight()).toBe('');

    vv.height = 800;
    vv.emitResize();
    expect(measuredHeight()).toBe('');
  });
});

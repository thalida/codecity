import { describe, it, expect, afterEach, vi } from 'vitest';
import { isDebugMode } from '@/utils/debugMode';

// isDebugMode() is a plain OR of three flags: DEV, VITE_DEBUG, and ?debug in the URL.

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.pushState({}, '', '/');
});

describe('isDebugMode', () => {
  it('is true when ?debug is present in the URL, with no env flags set', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEBUG', undefined);
    window.history.pushState({}, '', '/?debug');
    expect(isDebugMode()).toBe(true);
  });

  it('is false with no env flags and no ?debug param', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEBUG', undefined);
    window.history.pushState({}, '', '/');
    expect(isDebugMode()).toBe(false);
  });

  it('is true when DEV is on, regardless of the URL', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_DEBUG', undefined);
    window.history.pushState({}, '', '/');
    expect(isDebugMode()).toBe(true);
  });

  it('is true when VITE_DEBUG is set, regardless of DEV', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEBUG', 'true');
    window.history.pushState({}, '', '/');
    expect(isDebugMode()).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openBootPickerIfNeeded } from '@/state/bootView';
import { PROJECTS_VIEW } from '@/state/stores/ui';

function boot(search: string) {
  history.replaceState(null, '', `/${search}`);
  openBootPickerIfNeeded();
}

describe('openBootPickerIfNeeded', () => {
  beforeEach(() => {
    PROJECTS_VIEW.value = { visible: false, opts: {} };
  });

  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('opens the picker when there is no ?src to load', () => {
    boot('');
    expect(PROJECTS_VIEW.value.visible).toBe(true);
    expect(PROJECTS_VIEW.value.opts.dismissible).toBe(false);
  });

  // The reported bug: opening a repo from the discover list puts a bare ?src in
  // the URL, and reloading that URL used to land on the picker instead of the
  // city you were just looking at.
  it('loads a remote ?src with no ?branch instead of diverting to the picker', () => {
    boot('?src=https%3A%2F%2Fgithub.com%2Fpreactjs%2Fpreact');
    expect(PROJECTS_VIEW.value.visible).toBe(false);
  });

  it('loads a fully-specified ?src&?branch', () => {
    boot('?src=https%3A%2F%2Fgithub.com%2Fpreactjs%2Fpreact&branch=main');
    expect(PROJECTS_VIEW.value.visible).toBe(false);
  });

  it('loads a local ?src', () => {
    boot('?src=%2Frepos%2Fcodecity');
    expect(PROJECTS_VIEW.value.visible).toBe(false);
  });
});

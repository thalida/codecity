import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openBootPickerIfNeeded, readBootView } from '@/state/bootView';
import { NodeKind } from '@/types';
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

  // Reported bug: a bare ?src from the discover list used to land on the picker
  // instead of the city you were looking at.
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

describe('readBootView', () => {
  const read = (search: string) => {
    history.replaceState(null, '', `/${search}`);
    return readBootView();
  };

  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('reads the view the URL asks for', () => {
    const boot = read('?src=%2Frepos%2Fcodecity&mode=timeline&commit=abc123&sel=file:app/main.tsx');
    expect(boot).toEqual({
      src: '/repos/codecity',
      branch: undefined,
      timeline: true,
      commit: 'abc123',
      selection: { kind: NodeKind.File, path: 'app/main.tsx' },
    });
  });

  it('reads a bare source as Live at the present with nothing selected', () => {
    expect(read('?src=%2Frepos%2Fcodecity')).toEqual({
      src: '/repos/codecity',
      branch: undefined,
      timeline: false,
      commit: null,
      selection: null,
    });
  });

  it('names a directory and a commit selection by their own kinds', () => {
    expect(read('?src=%2Fr&sel=dir:app/src').selection).toEqual({
      kind: NodeKind.Directory,
      path: 'app/src',
    });
    expect(read('?src=%2Fr&sel=commit:abc123').selection).toEqual({
      kind: NodeKind.Commit,
      sha: 'abc123',
    });
  });

  it('ignores a selection it cannot read', () => {
    expect(read('?src=%2Fr&sel=nonsense').selection).toBeNull();
    expect(read('?src=%2Fr&sel=file:').selection).toBeNull();
    expect(read('?src=%2Fr&sel=:app/main.tsx').selection).toBeNull();
  });

  // A local checkout has no branch axis, so a stale ?branch can't split its
  // identity from the source that loads.
  it('drops a branch a local source cannot have', () => {
    expect(read('?src=%2Frepos%2Fcodecity&branch=stale').branch).toBeUndefined();
    expect(read('?src=https%3A%2F%2Fgithub.com%2Fo%2Fr&branch=dev').branch).toBe('dev');
  });
});

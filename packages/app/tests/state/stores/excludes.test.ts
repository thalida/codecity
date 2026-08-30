import { describe, it, expect, beforeEach } from 'vitest';
import {
  CURRENT_SOURCE,
  EXCLUDES,
  ACTIVE_EXCLUDES,
  addExclude,
  removeExclude,
  clearExcludes,
  activeExcludePathsFor,
} from '@/state/source';
import { sourceKey } from '@codecity/city';

beforeEach(() => {
  EXCLUDES.value = {};
  CURRENT_SOURCE.value = null;
});

describe('excludes store', () => {
  it('adds, sorts, and dedupes per repo', () => {
    CURRENT_SOURCE.value = { src: 'github.com/o/r', branch: 'main' };
    addExclude('src/b');
    addExclude('src/a');
    addExclude('src/a'); // dupe
    expect(ACTIVE_EXCLUDES.value).toEqual(['src/a', 'src/b']);
  });

  it('is repo-scoped and branch-invariant', () => {
    CURRENT_SOURCE.value = { src: 'github.com/o/r', branch: 'main' };
    addExclude('vendor');
    CURRENT_SOURCE.value = { src: 'github.com/o/r', branch: 'dev' };
    expect(ACTIVE_EXCLUDES.value).toEqual(['vendor']); // same repo, other branch
    CURRENT_SOURCE.value = { src: 'github.com/o/other', branch: 'main' };
    expect(ACTIVE_EXCLUDES.value).toEqual([]); // different repo
  });

  it('removes and clears', () => {
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    addExclude('a');
    addExclude('b');
    removeExclude('a');
    expect(ACTIVE_EXCLUDES.value).toEqual(['b']);
    clearExcludes();
    expect(ACTIVE_EXCLUDES.value).toEqual([]);
  });

  it('no-ops when no source is loaded', () => {
    addExclude('a');
    expect(EXCLUDES.value).toEqual({});
  });

  it('activeExcludePathsFor reads by src ignoring branch', () => {
    CURRENT_SOURCE.value = { src: 's', branch: 'main' };
    addExclude('x');
    expect(activeExcludePathsFor('s')).toEqual(['x']);
    expect(activeExcludePathsFor('other')).toEqual([]);
  });

  it('persists the whole map to localStorage (survives reload)', () => {
    CURRENT_SOURCE.value = { src: 'github.com/o/r', branch: 'main' };
    addExclude('vendor');

    const raw = localStorage.getItem('cc.excludes');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ [sourceKey('github.com/o/r')]: ['vendor'] });

    // Clearing the last path removes the slot entirely (empty map == default).
    clearExcludes();
    expect(localStorage.getItem('cc.excludes')).toBeNull();
  });
});

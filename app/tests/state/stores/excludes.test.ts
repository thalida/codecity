import { describe, it, expect, beforeEach } from 'vitest';
import { EXCLUDES, activeExcludePathsFor } from '@/state/stores/source';
import { sourceKey } from '@/utils/sources';
import { makeSession } from '../../_helpers/project';
import type { ProjectSession } from '@/state/project/session';

let session: ProjectSession;

beforeEach(() => {
  EXCLUDES.value = {};
  session = makeSession();
});

describe('excludes store', () => {
  it('adds, sorts, and dedupes per repo', () => {
    session.source.current.value = { src: 'github.com/o/r', branch: 'main' };
    session.source.addExclude('src/b');
    session.source.addExclude('src/a');
    session.source.addExclude('src/a'); // dupe
    expect(session.source.excludes.value).toEqual(['src/a', 'src/b']);
  });

  it('is repo-scoped and branch-invariant', () => {
    session.source.current.value = { src: 'github.com/o/r', branch: 'main' };
    session.source.addExclude('vendor');
    session.source.current.value = { src: 'github.com/o/r', branch: 'dev' };
    expect(session.source.excludes.value).toEqual(['vendor']); // same repo, other branch
    session.source.current.value = { src: 'github.com/o/other', branch: 'main' };
    expect(session.source.excludes.value).toEqual([]); // different repo
  });

  it('removes and clears', () => {
    session.source.current.value = { src: 's', branch: undefined };
    session.source.addExclude('a');
    session.source.addExclude('b');
    session.source.removeExclude('a');
    expect(session.source.excludes.value).toEqual(['b']);
    session.source.clearExcludes();
    expect(session.source.excludes.value).toEqual([]);
  });

  it('no-ops when no source is loaded', () => {
    session.source.addExclude('a');
    expect(EXCLUDES.value).toEqual({});
  });

  it('activeExcludePathsFor reads by src ignoring branch', () => {
    session.source.current.value = { src: 's', branch: 'main' };
    session.source.addExclude('x');
    expect(activeExcludePathsFor('s')).toEqual(['x']);
    expect(activeExcludePathsFor('other')).toEqual([]);
  });

  it('persists the whole map to localStorage (survives reload)', () => {
    session.source.current.value = { src: 'github.com/o/r', branch: 'main' };
    session.source.addExclude('vendor');

    const raw = localStorage.getItem('cc.excludes');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ [sourceKey('github.com/o/r')]: ['vendor'] });

    // Clearing the last path removes the slot entirely (empty map == default).
    session.source.clearExcludes();
    expect(localStorage.getItem('cc.excludes')).toBeNull();
  });
});

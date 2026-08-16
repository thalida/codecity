import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The selection commands, stubbed: what matters is the URL's selection being
// put back. Partial, since the timeline entry points read the rest.
vi.mock('@/city/sceneHandle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/city/sceneHandle')>()),
  showPath: vi.fn(),
  showCommit: vi.fn(),
  clearSelection: vi.fn(),
}));

import { attachViewUrlReactions } from '@/router/viewBinding';
import { showPath, showCommit } from '@/city/sceneHandle';
import { CURRENT_SOURCE, commitSource } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { BUILT_MANIFEST, markDecorating, markIdle } from '@/state/stores/build';
import { PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SCRUB_DRAGGING,
  setScrubPos,
  setTodayMs,
  resetTimelineMode,
} from '@/state/stores/timeline';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { makeCommitBundle } from '../_helpers/scrub';
import { flush } from '../_helpers/preact';
import { NodeKind } from '@/types';
import type { Manifest } from '@/types';
import { navigate, ROUTE_PARAMS, ROUTE_SEARCH } from '@/router/location';
import { ROUTES } from '@/router/paths';

const SRC = '/repos/codecity';
// A loaded manifest, repo and all: commitSource reads it the way the header does.
const LOADED = {
  tree: { name: 'codecity' },
  repo: { branch: 'main', remote_url: null, head_sha: 'abc', dirty: false },
} as unknown as Manifest;

const params = (): URLSearchParams => ROUTE_PARAMS.value;

/** A source loaded and its city built, each through the function that really
 *  does it. */
function commitWorld(src = SRC): void {
  commitSource(src, undefined, LOADED);
  markIdle();
}

describe('view URL', () => {
  let dispose: (() => void) | null = null;

  const attach = (search = ''): void => {
    navigate(`/city${search}`, { replace: true });
    dispose = attachViewUrlReactions();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    navigate(ROUTES.HOME, { replace: true });
    CURRENT_SOURCE.value = null;
    MANIFEST.value = EMPTY_MANIFEST;
    BUILT_MANIFEST.value = EMPTY_MANIFEST;
    PICKER_SELECTION_KEY.value = null;
    resetTimelineMode();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  describe('reflection', () => {
    it('leaves the URL alone until a source is applied', () => {
      attach();
      PICKER_SELECTION_KEY.value = { kind: NodeKind.File, path: 'app/src/main.tsx' };
      expect(ROUTE_SEARCH.value).toBe('');
    });

    it('writes the selected file, and drops it when the selection is cleared', () => {
      attach();
      commitWorld();

      PICKER_SELECTION_KEY.value = { kind: NodeKind.File, path: 'app/src/main.tsx' };
      expect(params().get('sel')).toBe('file:app/src/main.tsx');

      PICKER_SELECTION_KEY.value = null;
      expect(params().has('sel')).toBe(false);
      // The source reflection's params are untouched by ours.
      expect(params().get('src')).toBe(SRC);
    });

    it('names a selected directory and a selected commit by their own kinds', () => {
      attach();
      commitWorld();

      PICKER_SELECTION_KEY.value = { kind: NodeKind.Directory, path: 'app/src' };
      expect(params().get('sel')).toBe('dir:app/src');

      PICKER_SELECTION_KEY.value = { kind: NodeKind.Commit, sha: 'abc123' };
      expect(params().get('sel')).toBe('commit:abc123');
    });

    it('writes the commit the scrubber rests on, and nothing at the present', () => {
      attach();
      commitWorld();
      TIMELINE_BUNDLE.value = makeCommitBundle(4);
      TIMELINE_MODE.value = true;

      setScrubPos(1);
      expect(params().get('mode')).toBe('timeline');
      expect(params().get('commit')).toBe('c1');

      // The newest commit with no today stop past it: that IS the present, and
      // a link meaning "now" keeps meaning it as the branch moves.
      setScrubPos(3);
      expect(params().get('mode')).toBe('timeline');
      expect(params().has('commit')).toBe(false);
    });

    it('tells the newest commit from the today stop past it', () => {
      attach();
      commitWorld();
      TIMELINE_BUNDLE.value = makeCommitBundle(4, '2020-01-01T00:00:00Z');
      setTodayMs(Date.parse('2024-01-01T00:00:00Z'));
      TIMELINE_MODE.value = true;

      setScrubPos(3); // the last commit
      expect(params().get('commit')).toBe('c3');

      setScrubPos(4); // today, four years of nothing later
      expect(params().has('commit')).toBe(false);
    });

    it('holds the URL still through a drag, and writes where it comes to rest', () => {
      attach();
      commitWorld();
      TIMELINE_BUNDLE.value = makeCommitBundle(4);
      TIMELINE_MODE.value = true;
      setScrubPos(0);

      SCRUB_DRAGGING.value = true;
      setScrubPos(1);
      setScrubPos(2);
      expect(params().get('commit')).toBe('c0');

      SCRUB_DRAGGING.value = false;
      expect(params().get('commit')).toBe('c2');
    });

    // The bundle lands before the mode flips (loadTimelineScene packs the union
    // city first), so a scrub position exists for a moment while still in Live.
    it('writes no commit while Live, bundle or no bundle', () => {
      attach();
      commitWorld();
      TIMELINE_BUNDLE.value = makeCommitBundle(4);
      setScrubPos(1);

      expect(params().has('mode')).toBe(false);
      expect(params().has('commit')).toBe(false);
    });

    it('drops the mode and the commit on the way back to Live', () => {
      attach();
      commitWorld();
      TIMELINE_BUNDLE.value = makeCommitBundle(4);
      TIMELINE_MODE.value = true;
      setScrubPos(1);
      expect(params().get('commit')).toBe('c1');

      resetTimelineMode();
      expect(params().has('mode')).toBe(false);
      expect(params().has('commit')).toBe(false);
    });
  });

  describe('restore', () => {
    it('selects the file the URL names, once the city is built', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      expect(showPath).not.toHaveBeenCalled(); // no city yet — nothing to select in

      commitWorld();
      await flush();
      expect(showPath).toHaveBeenCalledWith('app/src/main.tsx');
    });

    it('goes to the commit a commit selection names', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=commit:abc123');
      commitWorld();
      await flush();
      expect(showCommit).toHaveBeenCalledWith('abc123');
    });

    it('ignores a selection it cannot read, and drops it from the URL', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=nonsense');
      commitWorld();
      await flush();
      expect(showPath).not.toHaveBeenCalled();
      expect(showCommit).not.toHaveBeenCalled();
      expect(params().has('sel')).toBe(false);
    });

    it('drops a saved view when a different repo is the one that loads', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      commitWorld('/repos/somewhere-else');
      await flush();
      expect(showPath).not.toHaveBeenCalled();
      expect(params().has('sel')).toBe(false);
    });

    // The empty boot city settles into Idle before the source lands, with no
    // building to select: restoring there erases the params it was holding.
    it('waits for the apply, not for whatever left the city Idle', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      markIdle(); // the empty boot city settles, before any source
      commitSource(SRC, undefined, LOADED);
      await flush();
      expect(showPath).not.toHaveBeenCalled();
      expect(params().get('sel')).toBe('file:app/src/main.tsx'); // and still held

      markDecorating(); // the committed manifest's city lands
      await flush();
      expect(showPath).toHaveBeenCalledWith('app/src/main.tsx');
    });

    // A remount is not a boot: re-entering Timeline on the city already
    // restored into refetches the history bundle and repacks it for nothing.
    it('does not restore a second time when the app remounts', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      commitWorld();
      await flush();
      expect(showPath).toHaveBeenCalledTimes(1);

      dispose?.();
      dispose = attachViewUrlReactions();
      await flush();
      expect(showPath).toHaveBeenCalledTimes(1);
    });
  });
});

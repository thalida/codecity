import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@preact/signals';

import { attachViewUrlReactions } from '@/router/viewBinding';
import { attachSourceReflection } from '@/router/urlBinding';
import { FocusMode } from '@/city/scene/render/cameraRig';

import { makeCommitBundle } from '../_helpers/scrub';
import { flush } from '../_helpers/preact';
import { NodeKind } from '@/types';
import type { Manifest, PickerSelectionKey } from '@/types';
import type { CityScene } from '@/city/scene/types';
import { navigate, ROUTE_PARAMS, ROUTE_SEARCH } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { makeSession } from '../_helpers/city';

// Spies on THIS session's commands and timeline: what matters is the URL's
// selection going back, not the bundle fetch and repack behind it.
const session = makeSession();
// The selection lives on the city's picker, so this session gets one: a fake,
// since what is under test is the URL either side of it.
const selectionKey = signal<PickerSelectionKey | null>(null);
session.scene.value = { picker: { selectionKey } } as unknown as CityScene;
const goToPath = vi.spyOn(session.commands, 'goToPath').mockImplementation(() => {});
const goToCommit = vi.spyOn(session.commands, 'goToCommit').mockImplementation(() => {});
const clearSelection = vi.spyOn(session.commands, 'clearSelection').mockImplementation(() => {});
const loadTimelineScene = vi
  .spyOn(session.timelineMode, 'loadScene')
  .mockImplementation(async () => {});
const exitTimelineMode = vi.spyOn(session.timelineMode, 'exit').mockImplementation(() => {});
const viewCommitInTimeline = vi
  .spyOn(session.timelineMode, 'viewCommit')
  .mockImplementation(async () => {});

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
  session.source.set(src, undefined, LOADED);
  session.progress.markIdle();
}

describe('view URL', () => {
  let dispose: (() => void) | null = null;

  const attach = (search = ''): void => {
    navigate(`/city${search}`, { replace: true });
    const stopView = attachViewUrlReactions(session);
    const stopSource = attachSourceReflection(session);
    dispose = () => {
      stopView();
      stopSource();
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    navigate(ROUTES.HOME, { replace: true });
    session.source.current.value = null;
    session.manifest.current.value = null;
    session.progress.builtManifest.value = null;
    selectionKey.value = null;
    session.timeline.reset();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  describe('reflection', () => {
    it('leaves the URL alone until a source is applied', () => {
      attach();
      selectionKey.value = {
        kind: NodeKind.File,
        path: 'app/src/main.tsx',
      };
      expect(ROUTE_SEARCH.value).toBe('');
    });

    it('writes the selected file, and drops it when the selection is cleared', () => {
      attach();
      commitWorld();

      selectionKey.value = {
        kind: NodeKind.File,
        path: 'app/src/main.tsx',
      };
      expect(params().get('sel')).toBe('file:app/src/main.tsx');

      selectionKey.value = null;
      expect(params().has('sel')).toBe(false);
      // The source reflection's params are untouched by ours.
      expect(params().get('src')).toBe(SRC);
    });

    it('names a selected directory and a selected commit by their own kinds', () => {
      attach();
      commitWorld();

      selectionKey.value = { kind: NodeKind.Directory, path: 'app/src' };
      expect(params().get('sel')).toBe('dir:app/src');

      selectionKey.value = { kind: NodeKind.Commit, sha: 'abc123' };
      expect(params().get('sel')).toBe('commit:abc123');
    });

    it('writes the commit the scrubber rests on, and nothing at the present', () => {
      attach();
      commitWorld();
      session.timeline.bundle.value = makeCommitBundle(4);
      session.timeline.mode.value = true;

      session.timeline.setScrubPos(1);
      expect(params().get('mode')).toBe('timeline');
      expect(params().get('commit')).toBe('c1');

      // The newest commit with no today stop past it: that IS the present, and
      // a link meaning "now" keeps meaning it as the branch moves.
      session.timeline.setScrubPos(3);
      expect(params().get('mode')).toBe('timeline');
      expect(params().has('commit')).toBe(false);
    });

    it('tells the newest commit from the today stop past it', () => {
      attach();
      commitWorld();
      session.timeline.bundle.value = makeCommitBundle(4, '2020-01-01T00:00:00Z');
      session.timeline.setTodayMs(Date.parse('2024-01-01T00:00:00Z'));
      session.timeline.mode.value = true;

      session.timeline.setScrubPos(3); // the last commit
      expect(params().get('commit')).toBe('c3');

      session.timeline.setScrubPos(4); // today, four years of nothing later
      expect(params().has('commit')).toBe(false);
    });

    it('holds the URL still through a drag, and writes where it comes to rest', () => {
      attach();
      commitWorld();
      session.timeline.bundle.value = makeCommitBundle(4);
      session.timeline.mode.value = true;
      session.timeline.setScrubPos(0);

      session.timeline.dragging.value = true;
      session.timeline.setScrubPos(1);
      session.timeline.setScrubPos(2);
      expect(params().get('commit')).toBe('c0');

      session.timeline.dragging.value = false;
      expect(params().get('commit')).toBe('c2');
    });

    // The bundle lands before the mode flips (loadTimelineScene packs the union
    // city first), so a scrub position exists for a moment while still in Live.
    it('writes no commit while Live, bundle or no bundle', () => {
      attach();
      commitWorld();
      session.timeline.bundle.value = makeCommitBundle(4);
      session.timeline.setScrubPos(1);

      expect(params().has('mode')).toBe(false);
      expect(params().has('commit')).toBe(false);
    });

    it('drops the mode and the commit on the way back to Live', () => {
      attach();
      commitWorld();
      session.timeline.bundle.value = makeCommitBundle(4);
      session.timeline.mode.value = true;
      session.timeline.setScrubPos(1);
      expect(params().get('commit')).toBe('c1');

      session.timeline.reset();
      expect(params().has('mode')).toBe(false);
      expect(params().has('commit')).toBe(false);
    });
  });

  describe('restore', () => {
    it('selects the file the URL names, once the city is built', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      expect(goToPath).not.toHaveBeenCalled(); // no city yet — nothing to select in

      commitWorld();
      await flush();
      expect(goToPath).toHaveBeenCalledWith('app/src/main.tsx', FocusMode.Recenter);
    });

    it('goes to the commit a commit selection names', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=commit:abc123');
      commitWorld();
      await flush();
      expect(goToCommit).toHaveBeenCalledWith('abc123', FocusMode.Recenter);
    });

    it('ignores a selection it cannot read, and drops it from the URL', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=nonsense');
      commitWorld();
      await flush();
      expect(goToPath).not.toHaveBeenCalled();
      expect(goToCommit).not.toHaveBeenCalled();
      expect(params().has('sel')).toBe(false);
    });

    it('drops a saved view when a different repo is the one that loads', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      commitWorld('/repos/somewhere-else');
      await flush();
      expect(goToPath).not.toHaveBeenCalled();
      expect(params().has('sel')).toBe(false);
    });

    // The empty boot city settles into Idle before the source lands, with no
    // building to select: restoring there erases the params it was holding.
    it('waits for the apply, not for whatever left the city Idle', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      session.progress.markIdle(); // the empty boot city settles, before any source
      session.source.set(SRC, undefined, LOADED);
      await flush();
      expect(goToPath).not.toHaveBeenCalled();
      expect(params().get('sel')).toBe('file:app/src/main.tsx'); // and still held

      session.progress.markIdle(); // the committed manifest's city lands
      await flush();
      expect(goToPath).toHaveBeenCalledWith('app/src/main.tsx', FocusMode.Recenter);
    });

    // Trees are placed at the END of the decoration pass: a commit restored
    // while it runs has no tree, so the camera has nothing to centre on.
    it('waits for the whole build, not the paint the decoration starts from', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=commit:abc123');
      session.source.set(SRC, undefined, LOADED);
      session.progress.markDecorating(); // city on screen, trees still in flight
      await flush();
      expect(goToCommit).not.toHaveBeenCalled();

      session.progress.markIdle(); // trees placed, build over
      await flush();
      expect(goToCommit).toHaveBeenCalledWith('abc123', FocusMode.Recenter);
    });

    // Back and Forward land here: the URL moves under a city that is already up,
    // which is a different path from restoring one at load.
    describe('back and forward', () => {
      /** A built city, already followed once, so the gate is open. */
      async function loadedAndFollowed(search = ''): Promise<void> {
        attach(`?src=%2Frepos%2Fcodecity${search}`);
        commitWorld();
        await flush();
        vi.clearAllMocks();
      }

      it('back into Timeline loads it at the commit the URL names', async () => {
        await loadedAndFollowed();

        navigate('/city?src=%2Frepos%2Fcodecity&mode=timeline&commit=c1');
        await flush();

        expect(loadTimelineScene).toHaveBeenCalledWith({ commit: 'c1' });
        expect(exitTimelineMode).not.toHaveBeenCalled();
      });

      it('back out of Timeline exits it', async () => {
        session.timeline.bundle.value = makeCommitBundle(4);
        session.timeline.mode.value = true;
        await loadedAndFollowed('&mode=timeline');

        navigate('/city?src=%2Frepos%2Fcodecity');
        await flush();

        expect(exitTimelineMode).toHaveBeenCalled();
        expect(loadTimelineScene).not.toHaveBeenCalled();
      });

      it('a different commit scrubs there, without refetching the bundle', async () => {
        session.timeline.bundle.value = makeCommitBundle(4);
        session.timeline.mode.value = true;
        session.timeline.setScrubPos(1);
        await loadedAndFollowed('&mode=timeline&commit=c1');

        navigate('/city?src=%2Frepos%2Fcodecity&mode=timeline&commit=c2');
        await flush();

        expect(viewCommitInTimeline).toHaveBeenCalledWith('c2');
        expect(loadTimelineScene).not.toHaveBeenCalled(); // the bundle is already here
      });

      it('the same commit asks for nothing', async () => {
        session.timeline.bundle.value = makeCommitBundle(4);
        session.timeline.mode.value = true;
        session.timeline.setScrubPos(1);
        await loadedAndFollowed('&mode=timeline&commit=c1');

        navigate('/city?src=%2Frepos%2Fcodecity&mode=timeline&commit=c1');
        await flush();

        expect(viewCommitInTimeline).not.toHaveBeenCalled();
        expect(loadTimelineScene).not.toHaveBeenCalled();
      });

      // The reported hang: the follow woke on its own writes and re-asked for the
      // restored commit, dragging the scrub back under the user every frame.
      it('lets the user scrub away from the commit it restored', async () => {
        session.timeline.bundle.value = makeCommitBundle(4);
        session.timeline.mode.value = true;
        session.timeline.setScrubPos(1);
        attach('?src=%2Frepos%2Fcodecity&mode=timeline&commit=c1');
        commitWorld();
        await flush();
        vi.clearAllMocks();

        session.timeline.setScrubPos(2);
        await flush();
        session.timeline.setScrubPos(3);
        await flush();

        // Nothing re-issued: the scrub is the user's, not the URL's.
        expect(viewCommitInTimeline).not.toHaveBeenCalled();
      });

      it('back to a different selection re-applies it', async () => {
        await loadedAndFollowed('&sel=file:a.ts');

        navigate('/city?src=%2Frepos%2Fcodecity&sel=file:b.ts');
        await flush();

        expect(goToPath).toHaveBeenCalledWith('b.ts', FocusMode.Recenter);
      });

      it('back past a selection clears it', async () => {
        await loadedAndFollowed('&sel=file:b.ts');
        // goToPath is stubbed, so stand the picker up by hand: without it there is
        // no selection for the URL to disagree with.
        selectionKey.value = { kind: NodeKind.File, path: 'b.ts' };
        await flush();

        navigate('/city?src=%2Frepos%2Fcodecity');
        await flush();

        expect(clearSelection).toHaveBeenCalled();
      });
    });

    // A remount is not a boot: re-entering Timeline on the city already
    // restored into refetches the history bundle and repacks it for nothing.
    it('does not restore a second time when the app remounts', async () => {
      attach('?src=%2Frepos%2Fcodecity&sel=file:app/src/main.tsx');
      commitWorld();
      await flush();
      expect(goToPath).toHaveBeenCalledTimes(1);

      dispose?.();
      const stopView = attachViewUrlReactions(session);
      const stopSource = attachSourceReflection(session);
      dispose = () => {
        stopView();
        stopSource();
      };
      await flush();
      expect(goToPath).toHaveBeenCalledTimes(1);
    });
  });
});

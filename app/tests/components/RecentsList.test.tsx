// Native-harness tests for RecentsList — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { RECENTS, CURRENT_SOURCE } from '@/state/stores/source';
import { SERVER_CONFIG, DEFAULT_SERVER_CONFIG } from '@/state/stores/serverConfig';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { RecentsList } from '@/components/RecentsList/RecentsList';
import type { Manifest } from '@/types';
import { flush } from '../_helpers/preact';

describe('RecentsList', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    RECENTS.value = [
      {
        src: 'https://github.com/o/alpha',
        branch: 'main',
        label: 'o/alpha',
        lastOpenedAt: 2,
      },
      { src: 'https://github.com/o/beta', branch: 'dev', label: 'o/beta', lastOpenedAt: 1 },
    ];
    CURRENT_SOURCE.value = { src: 'https://github.com/o/alpha', branch: 'main' };
    // SOURCE_INFO (which active detection reads) derives from a loaded manifest.
    setManifest({ tree: { name: 'o/alpha' }, repo: { branch: 'main' } } as unknown as Manifest);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    RECENTS.value = [];
    CURRENT_SOURCE.value = null;
    setManifest(EMPTY_MANIFEST);
    SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: false };
  });

  it('marks the CURRENT_SOURCE row active', async () => {
    render(<RecentsList onOpen={() => {}} />, container);
    await flush();

    const activeRow = container.querySelector('.source-row--active');
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('o/alpha');
  });

  it('the active row is clickable and re-opens (reloads) the current project', async () => {
    const onOpen = vi.fn();
    render(<RecentsList onOpen={onOpen} />, container);
    await flush();

    const activeRow = container.querySelector<HTMLButtonElement>('.source-row--active')!;
    expect(activeRow.disabled).toBe(false);
    activeRow.click();
    expect(onOpen).toHaveBeenCalledWith({ src: 'https://github.com/o/alpha', branch: 'main' });
  });

  it('renders a branch-less local recent with no @branch pill, matched active by path', async () => {
    SERVER_CONFIG.value = { ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true };
    // A local recent is branch-less; CURRENT_SOURCE is too, so they match by src
    // even though the loaded manifest reports a checkout branch (display only).
    RECENTS.value = [{ src: '/Users/me/proj', label: 'proj', lastOpenedAt: 3 }];
    CURRENT_SOURCE.value = { src: '/Users/me/proj' };
    setManifest({ tree: { name: 'proj' }, repo: { branch: 'feat/x' } } as unknown as Manifest);
    render(<RecentsList onOpen={() => {}} />, container);
    await flush();

    const rows = container.querySelectorAll('.recent-item');
    expect(rows).toHaveLength(1);
    expect(container.querySelector('.app-header-branch-pill')).toBeNull();
    expect(container.querySelector('.source-row--active')).toBeTruthy();
  });

  it('remove forgets the entry behind a confirm step', async () => {
    render(<RecentsList onOpen={() => {}} />, container);
    await flush();

    const removeButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Remove from recents"]'
    );
    removeButtons[0].click(); // alpha row -> ask
    await flush();

    // The confirm takes over the row (no reflow): the row's own confirm bar
    // replaces its content rather than being appended beside it.
    expect(container.querySelector('.recent-confirm')).not.toBeNull();

    const confirmButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Remove'
    );
    expect(confirmButtons.length).toBeGreaterThan(0);
    (confirmButtons[0] as HTMLButtonElement).click();
    await flush();

    expect(RECENTS.value.find((r) => r.label === 'o/alpha')).toBeUndefined();
  });
});

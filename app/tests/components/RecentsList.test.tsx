// Native-harness tests for RecentsList — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { RECENTS, CURRENT_SOURCE } from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { RecentsList } from '@/components/RecentsList/RecentsList';
import * as manifestApi from '@/api/manifest';
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
        branchIsDefault: true,
        label: 'o/alpha',
        lastOpenedAt: 2,
      },
      { src: 'https://github.com/o/beta', branch: 'dev', label: 'o/beta', lastOpenedAt: 1 },
    ];
    CURRENT_SOURCE.value = { src: 'https://github.com/o/alpha', branch: 'main' };
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    RECENTS.value = [];
    CURRENT_SOURCE.value = null;
    SERVER_CONFIG.value = { allowLocalRepos: false };
  });

  it('marks the CURRENT_SOURCE row active and tags default branches', async () => {
    render(<RecentsList onOpen={() => {}} />, container);
    await flush();

    const activeRow = container.querySelector('.recent-row--active');
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('o/alpha');
    expect(container.textContent).toContain('(default)');
  });

  it('the active row is clickable and re-opens (reloads) the current project', async () => {
    const onOpen = vi.fn();
    render(<RecentsList onOpen={onOpen} />, container);
    await flush();

    const activeRow = container.querySelector<HTMLButtonElement>('.recent-row--active')!;
    expect(activeRow.disabled).toBe(false);
    activeRow.click();
    expect(onOpen).toHaveBeenCalledWith({ src: 'https://github.com/o/alpha', branch: 'main' });
  });

  it('remove is non-destructive: forgets the entry, does not touch the cache', async () => {
    const spy = vi.spyOn(manifestApi, 'clearManifestCache');
    render(<RecentsList onOpen={() => {}} />, container);
    await flush();

    const removeButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Remove from recents"]'
    );
    removeButtons[0].click(); // alpha row -> ask
    await flush();

    const confirmButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Remove'
    );
    expect(confirmButtons.length).toBeGreaterThan(0);
    (confirmButtons[0] as HTMLButtonElement).click();
    await flush();

    expect(RECENTS.value.find((r) => r.label === 'o/alpha')).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

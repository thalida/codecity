// Native-harness tests for RecentsList — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { RECENTS, CURRENT_SOURCE } from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { RecentsList } from '@/views/ProjectsView/RecentsList';
import * as manifestApi from '@/api/manifest';
import { flush } from '../../_helpers/preact';

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

  it('filters by label/src as you type', async () => {
    render(<RecentsList onOpen={() => {}} />, container);
    await flush();

    const filterInput = container.querySelector<HTMLInputElement>('.recents-filter')!;
    filterInput.value = 'beta';
    filterInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    const labels = Array.from(container.querySelectorAll('.recent-label')).map(
      (el) => el.textContent
    );
    expect(labels).not.toContain('o/alpha');
    expect(labels).toContain('o/beta');
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

  it('supports keyboard navigation: arrow keys move the highlight, Enter opens it', async () => {
    const onOpen = vi.fn();
    render(<RecentsList onOpen={onOpen} />, container);
    await flush();

    const list = container.querySelector<HTMLDivElement>('.recents')!;
    // Cursor starts at 0 (alpha, which is active/disabled-for-open); move down to beta.
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();

    const highlighted = container.querySelector('.recent-row--highlighted');
    expect(highlighted?.textContent).toContain('o/beta');

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(onOpen).toHaveBeenCalledWith({ src: 'https://github.com/o/beta', branch: 'dev' });

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();
    expect(container.querySelector('.recent-row--highlighted')?.textContent).toContain('o/alpha');
  });
});

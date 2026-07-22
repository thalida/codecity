import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { AppHeader } from '@/layout/AppHeader/AppHeader';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { flush } from '../_helpers/preact';

vi.mock('@/hooks/useTimelineMode', () => ({
  enterTimelineMode: vi.fn().mockResolvedValue(undefined),
  exitTimelineMode: vi.fn(),
}));
import { enterTimelineMode, exitTimelineMode } from '@/hooks/useTimelineMode';

const TEST_MANIFEST = {
  tree: { name: 'project', type: 'directory', path: '.', children: [] },
  repo: { remote_url: null, branch: 'main' },
};

describe('AppHeader — Timeline toggle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    CURRENT_SOURCE.value = null;
    setManifest(EMPTY_MANIFEST as never);
    TIMELINE_MODE.value = false;
    vi.clearAllMocks();
  });

  it('does not render the toggle before a source is loaded', async () => {
    render(<AppHeader />, container);
    await flush();

    expect(container.querySelector('#app-header-right .btn-icon')).toBeNull();
  });

  it('renders the toggle once a source is loaded, off by default', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);

    render(<AppHeader />, container);
    await flush();

    const btn = container.querySelector('#app-header-right .btn-icon')!;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('is-active')).toBe(false);
  });

  it('shows is-active when TIMELINE_MODE is on', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    TIMELINE_MODE.value = true;

    render(<AppHeader />, container);
    await flush();

    const btn = container.querySelector('#app-header-right .btn-icon')!;
    expect(btn.classList.contains('is-active')).toBe(true);
  });

  it('clicking while off calls enterTimelineMode, not exit', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    TIMELINE_MODE.value = false;

    render(<AppHeader />, container);
    await flush();

    const btn = container.querySelector<HTMLButtonElement>('#app-header-right .btn-icon')!;
    btn.click();

    expect(enterTimelineMode).toHaveBeenCalledTimes(1);
    expect(exitTimelineMode).not.toHaveBeenCalled();
  });

  it('clicking while on calls exitTimelineMode, not enter', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    TIMELINE_MODE.value = true;

    render(<AppHeader />, container);
    await flush();

    const btn = container.querySelector<HTMLButtonElement>('#app-header-right .btn-icon')!;
    btn.click();

    expect(exitTimelineMode).toHaveBeenCalledTimes(1);
    expect(enterTimelineMode).not.toHaveBeenCalled();
  });
});

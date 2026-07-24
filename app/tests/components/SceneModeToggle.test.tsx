import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { SceneModeToggle } from '@/components/SceneModeToggle/SceneModeToggle';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { flush } from '../_helpers/preact';

vi.mock('@/hooks/useTimelineMode', () => ({
  loadTimelineScene: vi.fn().mockResolvedValue(undefined),
  exitTimelineMode: vi.fn(),
}));
import { loadTimelineScene, exitTimelineMode } from '@/hooks/useTimelineMode';

const TEST_MANIFEST = {
  tree: { name: 'project', type: 'directory', path: '.', children: [] },
  repo: { remote_url: null, branch: 'main' },
};

function btns(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.scene-mode-btn'));
}

describe('SceneModeToggle', () => {
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

  it('does not render before a source is loaded', async () => {
    render(<SceneModeToggle />, container);
    await flush();
    expect(container.querySelector('.scene-mode-toggle')).toBeNull();
  });

  it('renders once a source is loaded, Live active by default', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    render(<SceneModeToggle />, container);
    await flush();

    const [live, timeline] = btns(container);
    expect(live.textContent).toBe('Live');
    expect(live.classList.contains('is-active')).toBe(true);
    expect(timeline.classList.contains('is-active')).toBe(false);
  });

  it('Timeline is active when TIMELINE_MODE is on', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    TIMELINE_MODE.value = true;
    render(<SceneModeToggle />, container);
    await flush();

    const [live, timeline] = btns(container);
    expect(timeline.classList.contains('is-active')).toBe(true);
    expect(live.classList.contains('is-active')).toBe(false);
  });

  it('clicking Timeline while live calls loadTimelineScene, not exit', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    render(<SceneModeToggle />, container);
    await flush();

    btns(container)[1].click(); // Timeline
    expect(loadTimelineScene).toHaveBeenCalledTimes(1);
    expect(exitTimelineMode).not.toHaveBeenCalled();
  });

  it('clicking Live while in timeline calls exitTimelineMode, not enter', async () => {
    CURRENT_SOURCE.value = { src: '/repo' };
    setManifest(TEST_MANIFEST as never);
    TIMELINE_MODE.value = true;
    render(<SceneModeToggle />, container);
    await flush();

    btns(container)[0].click(); // Live
    expect(exitTimelineMode).toHaveBeenCalledTimes(1);
    expect(loadTimelineScene).not.toHaveBeenCalled();
  });
});

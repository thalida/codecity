import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { TimelineToggle } from '@/components/timeline/TimelineToggle/TimelineToggle';
import { flush } from '../_helpers/preact';

import { makeSession, renderInProject } from '../_helpers/project';

// One project for this file, the way the app makes one for itself. The toggle
// drives ITS controller, so the spies go on the session rather than the module.
const session = makeSession();
const loadScene = vi.spyOn(session.timelineMode, 'loadScene').mockResolvedValue(undefined);
const exit = vi.spyOn(session.timelineMode, 'exit').mockImplementation(() => {});

const TEST_MANIFEST = {
  tree: { name: 'project', type: 'directory', path: '.', children: [] },
  repo: { remote_url: null, branch: 'main' },
};

function btns(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.timeline-toggle-btn'));
}

describe('TimelineToggle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    session.source.current.value = null;
    session.manifest.set(null);
    session.timeline.mode.value = false;
    vi.clearAllMocks();
  });

  it('does not render before a source is loaded', async () => {
    renderInProject(<TimelineToggle />, session, container);
    await flush();
    expect(container.querySelector('.timeline-toggle')).toBeNull();
  });

  it('renders once a source is loaded, Live active by default', async () => {
    session.source.current.value = { src: '/repo' };
    session.manifest.set(TEST_MANIFEST as never);
    renderInProject(<TimelineToggle />, session, container);
    await flush();

    const [live, timeline] = btns(container);
    expect(live.textContent).toBe('Live');
    expect(live.classList.contains('is-active')).toBe(true);
    expect(timeline.classList.contains('is-active')).toBe(false);
  });

  it('Timeline is active when TIMELINE_MODE is on', async () => {
    session.source.current.value = { src: '/repo' };
    session.manifest.set(TEST_MANIFEST as never);
    session.timeline.mode.value = true;
    renderInProject(<TimelineToggle />, session, container);
    await flush();

    const [live, timeline] = btns(container);
    expect(timeline.classList.contains('is-active')).toBe(true);
    expect(live.classList.contains('is-active')).toBe(false);
  });

  it('clicking Timeline while live calls loadTimelineScene, not exit', async () => {
    session.source.current.value = { src: '/repo' };
    session.manifest.set(TEST_MANIFEST as never);
    renderInProject(<TimelineToggle />, session, container);
    await flush();

    btns(container)[1].click(); // Timeline
    expect(loadScene).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('clicking Live while in timeline calls exitTimelineMode, not enter', async () => {
    session.source.current.value = { src: '/repo' };
    session.manifest.set(TEST_MANIFEST as never);
    session.timeline.mode.value = true;
    renderInProject(<TimelineToggle />, session, container);
    await flush();

    btns(container)[0].click(); // Live
    expect(exit).toHaveBeenCalledTimes(1);
    expect(loadScene).not.toHaveBeenCalled();
  });
});

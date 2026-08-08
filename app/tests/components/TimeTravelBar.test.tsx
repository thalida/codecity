// Native render/flush harness (mirrors the other component tests). The scrubber
// is a custom role="slider" track over a TIME axis, not a native range input.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE, setScrubPos } from '@/state/stores/timeline';
import { flush, drainAsync } from '../_helpers/preact';
import type { CommitEntry, TimelineBundle } from '@/types';

const commit = (sha: string, date: string, subject: string): CommitEntry => ({
  sha,
  date,
  subject,
  files: 1,
  authors: ['Someone'],
  same_day_total: 1,
});

const old = commit('aaaaaaa1111111111111111111111111111111', '2026-01-01', 'oldest');
const mid = commit('bbbbbbb2222222222222222222222222222222', '2026-02-01', 'middle');
const head = commit('ccccccc3333333333333333333333333333333', '2026-03-01', 'head');

const BUNDLE = {
  commits: [old, mid, head],
  unionManifest: { tree: { name: 'r' }, repo: { remote_url: 'https://example.com/r' } },
  deltas: [],
  blobLines: {},
  blobSizes: {},
  note: null,
} as unknown as TimelineBundle;

function track(container: HTMLElement) {
  return container.querySelector<HTMLDivElement>('.time-travel-track')!;
}

describe('TimeTravelBar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    TIMELINE_MODE.value = true;
    TIMELINE_BUNDLE.value = BUNDLE;
    setScrubPos(2);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    TIMELINE_MODE.value = false;
    setScrubPos(0);
    TIMELINE_BUNDLE.value = null;
  });

  it('renders nothing when timeline mode is off', async () => {
    TIMELINE_MODE.value = false;
    render(<TimeTravelBar />, container);
    await flush();
    expect(container.querySelector('.time-travel-bar')).toBeNull();
  });

  it('exposes a role=slider track spanning the commit range', async () => {
    render(<TimeTravelBar />, container);
    await flush();
    const t = track(container);
    expect(t.getAttribute('role')).toBe('slider');
    expect(t.getAttribute('aria-valuemin')).toBe('0');
    expect(t.getAttribute('aria-valuemax')).toBe('2');
    expect(t.getAttribute('aria-valuenow')).toBe('2');
    expect(t.getAttribute('aria-valuetext')).toContain(head.sha.slice(0, 7));
  });

  it('labels the track ends with the first and last commit dates', async () => {
    render(<TimeTravelBar />, container);
    await flush();
    const edges = container.querySelectorAll('.time-travel-edge');
    expect(edges).toHaveLength(2);
    expect(edges[0].textContent).toBe('Jan 1, 2026');
    expect(edges[1].textContent).toBe('Mar 1, 2026');
  });

  it('jumps to the first / latest commit when an edge date is clicked', async () => {
    setScrubPos(1);
    render(<TimeTravelBar />, container);
    await flush();
    const edges = container.querySelectorAll<HTMLButtonElement>('button.time-travel-edge');

    edges[0].click(); // first commit
    expect(SCRUB_POS.value).toBe(0);

    edges[1].click(); // latest commit
    expect(SCRUB_POS.value).toBe(2);
  });

  it('renders a tick canvas + a handle positioned by date fraction', async () => {
    render(<TimeTravelBar />, container);
    await flush();
    expect(track(container).querySelector('canvas.time-travel-ticks')).not.toBeNull();
    // At HEAD the handle sits at the far right (100%).
    const handle = container.querySelector<HTMLElement>('.time-travel-handle')!;
    expect(handle.style.left).toBe('100%');
  });

  it('drives SCRUB_POS from a pointer press by DATE, not by index', async () => {
    render(<TimeTravelBar />, container);
    await flush();
    const t = track(container);
    // jsdom returns a zero rect; pin a 100px-wide track at x=0.
    t.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }) as DOMRect;

    // Click the middle of the axis (~day 30 of a 59-day span) → between old (day
    // 0) and mid (day 31), landing ~0.95 of an index, NOT the index-linear 1.0.
    const ev = new Event('pointerdown', { bubbles: true }) as Event & {
      clientX: number;
      pointerId: number;
    };
    ev.clientX = 50;
    ev.pointerId = 1;
    t.dispatchEvent(ev);

    expect(SCRUB_POS.value).toBeGreaterThan(0.5);
    expect(SCRUB_POS.value).toBeLessThan(1);
  });

  it('steps one commit per arrow key and jumps with Home/End', async () => {
    render(<TimeTravelBar />, container);
    await flush();
    const t = track(container);

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(SCRUB_POS.value).toBe(1); // 2 -> 1

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(SCRUB_POS.value).toBe(0);

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(SCRUB_POS.value).toBe(2);
  });

  it('labels the current commit as date, then sha, then subject (date leads)', async () => {
    render(<TimeTravelBar />, container);
    await flush();
    const info = container.querySelector('.time-travel-info')!;
    const order = Array.from(info.children).map((c) => c.className.split(' ')[0]);
    expect(order).toEqual(['time-travel-date', 'time-travel-sha', 'time-travel-subject']);
    expect(info.querySelector('.time-travel-subject')!.textContent).toBe('head');
  });

  it('shows the interpolated date + "no commits" when scrubbed into a gap', async () => {
    setScrubPos(1.5); // halfway between the Feb 1 and Mar 1 commits (a >2-day gap)
    render(<TimeTravelBar />, container);
    await flush();
    const nocommit = container.querySelector('.time-travel-nocommit');
    expect(nocommit).not.toBeNull();
    expect(nocommit!.textContent).toBe('no commits');
    // No sha shown, and the date is the interpolated mid-gap day (Feb), not a commit.
    expect(container.querySelector('.time-travel-sha')).toBeNull();
    expect(container.querySelector('.time-travel-date')!.textContent).toContain('Feb');
  });

  it('single-commit repo: handle pins right, track is inert (no drag)', async () => {
    const only = commit('ddddddd4444444444444444444444444444444', '2026-07-24', 'init');
    TIMELINE_BUNDLE.value = {
      commits: [only],
      unionManifest: { tree: { name: 'r' }, repo: { remote_url: null } },
      deltas: [],
      blobLines: {},
      blobSizes: {},
      note: null,
    } as unknown as TimelineBundle;
    setScrubPos(0);
    render(<TimeTravelBar />, container);
    await flush();

    const t = track(container);
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(t.getAttribute('tabindex')).toBe('-1');
    expect(t.classList.contains('is-inert')).toBe(true);
    // Handle at the present (far right), not the left.
    expect(container.querySelector<HTMLElement>('.time-travel-handle')!.style.left).toBe('100%');

    // A pointer press does nothing: no drag engaged, SCRUB_POS unmoved.
    t.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }) as DOMRect;
    const ev = new Event('pointerdown', { bubbles: true }) as Event & {
      clientX: number;
      pointerId: number;
    };
    ev.clientX = 10;
    ev.pointerId = 1;
    t.dispatchEvent(ev);
    expect(SCRUB_POS.value).toBe(0);
  });

  it('same-day repo stays scrubbable: track is live, a press moves SCRUB_POS', async () => {
    const day = '2026-07-24';
    TIMELINE_BUNDLE.value = {
      commits: [
        commit('1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', day, 'c1'),
        commit('2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', day, 'c2'),
        commit('3333333ccccccccccccccccccccccccccccccccc', day, 'c3'),
      ],
      unionManifest: { tree: { name: 'r' }, repo: { remote_url: null } },
      deltas: [],
      blobLines: {},
      blobSizes: {},
      note: null,
    } as unknown as TimelineBundle;
    setScrubPos(2);
    render(<TimeTravelBar />, container);
    await flush();

    const t = track(container);
    expect(t.getAttribute('aria-disabled')).toBe('false');
    expect(t.classList.contains('is-inert')).toBe(false);
    // Handle starts at the present (right), not collapsed to the left.
    expect(container.querySelector<HTMLElement>('.time-travel-handle')!.style.left).toBe('100%');

    // Pressing at the left third lands on an earlier commit (index spacing).
    t.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 90, height: 20, right: 90, bottom: 20 }) as DOMRect;
    const ev = new Event('pointerdown', { bubbles: true }) as Event & {
      clientX: number;
      pointerId: number;
    };
    ev.clientX = 0;
    ev.pointerId = 1;
    t.dispatchEvent(ev);
    expect(SCRUB_POS.value).toBe(0);
  });

  it('tracks SCRUB_POS updates from outside the component', async () => {
    setScrubPos(0);
    render(<TimeTravelBar />, container);
    await flush();

    setScrubPos(1);
    await flush();

    expect(track(container).getAttribute('aria-valuenow')).toBe('1');
    expect(container.querySelector('.time-travel-sha')!.textContent).toBe(mid.sha.slice(0, 7));
  });

  // Regression: a mode check above the hooks froze effect deps while rendering
  // nothing, so re-entry on identical deps left the rebuilt canvas blank.
  it('repaints the tick canvas after leaving and re-entering on identical deps', async () => {
    const proto = HTMLElement.prototype;
    const saved = {
      w: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
      h: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
    };
    // jsdom reports 0, which makes the draw bail before it paints anything.
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 200 });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 24 });
    const ticks = () => container.querySelector<HTMLCanvasElement>('canvas.time-travel-ticks');
    try {
      render(<TimeTravelBar />, container);
      await drainAsync(3, 20); // useEffect lands on rAF, which jsdom runs at ~16ms
      const first = ticks()!;
      expect(first.width).toBe(200);

      TIMELINE_MODE.value = false;
      await drainAsync(3, 20); // useEffect lands on rAF, which jsdom runs at ~16ms
      expect(ticks()).toBeNull();

      TIMELINE_MODE.value = true; // same bundle, same position: no dep changes
      await drainAsync(3, 20); // useEffect lands on rAF, which jsdom runs at ~16ms
      const second = ticks()!;
      expect(second, 'the canvas is rebuilt, not reused').not.toBe(first);
      expect(second.width, 'and must be repainted').toBe(200);
    } finally {
      if (saved.w) Object.defineProperty(proto, 'clientWidth', saved.w);
      if (saved.h) Object.defineProperty(proto, 'clientHeight', saved.h);
    }
  });
});

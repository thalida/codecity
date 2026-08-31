// Native render/flush harness (mirrors the other component tests). The scrubber
// is a custom role="slider" track over a TIME axis, not a native range input.

import { parseDateMs } from '@codecity/city';
import type { TimelineBundle } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { TimelineScrubber } from '@/features/city/components/TimelineScrubber/TimelineScrubber';
import { renderWithCity, type FakeCity } from '../_helpers/cityChrome';
import { flush, drainAsync } from '../_helpers/preact';
import { commits as buildCommits, fakeCity } from '@codecity/city/testing';

const [old, mid, head] = buildCommits(
  { date: '2026-01-01', files: 1, subject: 'oldest', authors: ['Someone'] },
  { date: '2026-02-01', files: 1, subject: 'middle', authors: ['Someone'] },
  { date: '2026-03-01', files: 1, subject: 'head', authors: ['Someone'] }
);

const BUNDLE = {
  commits: [old, mid, head],
  unionManifest: { tree: { name: 'r' }, repo: { remote_url: 'https://example.com/r' } },
  deltas: [],
  blobLines: {},
  blobSizes: {},
  notes: [],
  note: null,
} as unknown as TimelineBundle;

function track(container: HTMLElement) {
  return container.querySelector<HTMLDivElement>('.timeline-scrubber-track')!;
}

describe('TimelineScrubber', () => {
  let container: HTMLDivElement;
  let city: FakeCity;

  /** Mount the scrubber over the city these cases drive. */
  const mount = () => void renderWithCity(<TimelineScrubber />, container, city);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    city = fakeCity();
    city.timeline.enter();
    city.timeline.setBundle(BUNDLE);
    // Today IS the last commit's day, so these cases have no extra stop; the
    // ones that need one move it forward.
    city.timeline.setTodayMs(parseDateMs('2026-03-01'));
    city.timeline.setPosition(2);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  // The city keeps aging after the last commit, so the track runs one stop past
  // it and the axis ends at today rather than at that commit's date.
  describe('today', () => {
    const aged = () => city.timeline.setTodayMs(parseDateMs('2026-06-15'));

    it('ends the axis at today and scrubs into the stretch since the last commit', async () => {
      aged();
      city.timeline.setPosition(3);
      mount();
      await flush();
      // Both ends name a date; the handle is the one that says where you are.
      const edges = container.querySelectorAll('.timeline-scrubber-edge');
      expect(edges[1].textContent).toBe('Jun 15, 2026');
      expect(edges[1].getAttribute('title')).toContain('June 15, 2026');
      expect(container.querySelector('.timeline-scrubber-date')!.textContent).toBe('Today');
      // No commit was made on it, so the row says so rather than carrying the
      // last commit's message forward.
      expect(container.querySelector('.timeline-scrubber-nocommit')).not.toBeNull();
    });

    it('names the day, not today, once scrubbed back off it', async () => {
      aged();
      city.timeline.setPosition(2);
      mount();
      await flush();
      expect(container.querySelector('.timeline-scrubber-date')!.textContent).toBe('Mar 1, 2026');
    });

    it('keeps the last commit as the end when nothing has aged since', async () => {
      mount();
      await flush();
      const edges = container.querySelectorAll('.timeline-scrubber-edge');
      expect(edges[1].textContent).toBe('Mar 1, 2026');
      expect(city.timeline.pos).toBe(2);
    });
  });

  it('renders nothing when timeline mode is off', async () => {
    city.timeline.exit();
    mount();
    await flush();
    expect(container.querySelector('.timeline-scrubber')).toBeNull();
  });

  it('exposes a role=slider track spanning the commit range', async () => {
    mount();
    await flush();
    const t = track(container);
    expect(t.getAttribute('role')).toBe('slider');
    expect(t.getAttribute('aria-valuemin')).toBe('0');
    expect(t.getAttribute('aria-valuemax')).toBe('2');
    expect(t.getAttribute('aria-valuenow')).toBe('2');
    expect(t.getAttribute('aria-valuetext')).toContain(head.sha.slice(0, 7));
  });

  it('labels the axis ends with the first and last commit dates', async () => {
    mount();
    await flush();
    const edges = container.querySelectorAll('.timeline-scrubber-edge');
    expect(edges).toHaveLength(2);
    expect(edges[0].textContent).toBe('Jan 1, 2026');
    expect(edges[1].textContent).toBe('Mar 1, 2026');
    expect(edges[0].getAttribute('title')).toContain('January 1, 2026');
  });

  // Three rows: the track, the dates it lands between, then the commit. The
  // track has its row to itself so it runs the bar's full width.
  it('stacks the track, the axis and the commit in that order', async () => {
    mount();
    await flush();
    const rows = Array.from(container.querySelector('.timeline-scrubber')!.children).map(
      (c) => c.className
    );
    expect(rows).toEqual([
      'timeline-scrubber-thumb',
      'timeline-scrubber-axis',
      'timeline-scrubber-info',
    ]);
    const scrubber = container.querySelector('.timeline-scrubber-thumb')!;
    expect(scrubber.querySelectorAll('.timeline-scrubber-edge')).toHaveLength(0);
    expect(scrubber.querySelector('.timeline-scrubber-track')).not.toBeNull();
    const axis = container.querySelector('.timeline-scrubber-axis')!;
    expect(axis.querySelectorAll('.timeline-scrubber-edge')).toHaveLength(2);
    // Row two is the three dates; the commit gets row three to itself, so a
    // long subject can't crowd them.
    expect(axis.querySelector('.timeline-scrubber-date')).not.toBeNull();
    expect(axis.querySelector('.timeline-scrubber-info')).toBeNull();
    expect(
      container.querySelector('.timeline-scrubber-info .timeline-scrubber-sha')
    ).not.toBeNull();
  });

  it('jumps to the first / latest commit when an edge date is clicked', async () => {
    city.timeline.setPosition(1);
    mount();
    await flush();
    const edges = container.querySelectorAll<HTMLButtonElement>('button.timeline-scrubber-edge');

    edges[0].click(); // first commit
    expect(city.timeline.pos).toBe(0);

    edges[1].click(); // latest commit
    expect(city.timeline.pos).toBe(2);
  });

  it('renders a tick canvas + a handle positioned by date fraction', async () => {
    mount();
    await flush();
    expect(track(container).querySelector('canvas.timeline-scrubber-ticks')).not.toBeNull();
    // At HEAD the handle sits at the far right (100%).
    const handle = container.querySelector<HTMLElement>('.timeline-scrubber-handle')!;
    expect(handle.style.left).toBe('100%');
  });

  it('drives SCRUB_POS from a pointer press by DATE, not by index', async () => {
    mount();
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

    expect(city.timeline.pos).toBeGreaterThan(0.5);
    expect(city.timeline.pos).toBeLessThan(1);
  });

  it('steps one commit per arrow key and jumps with Home/End', async () => {
    mount();
    await flush();
    const t = track(container);

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(city.timeline.pos).toBe(1); // 2 -> 1

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(city.timeline.pos).toBe(0);

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(city.timeline.pos).toBe(2);
  });

  // The scrubbed date sits on the axis with the two it falls between; the
  // commit it belongs to reads sha then subject on the row underneath.
  it('puts the scrubbed date on the axis and the commit below it', async () => {
    mount();
    await flush();
    const axis = container.querySelector('.timeline-scrubber-axis')!;
    expect(axis.querySelector('.timeline-scrubber-date')).not.toBeNull();
    const info = container.querySelector('.timeline-scrubber-info')!;
    const order = Array.from(info.children).map((c) => c.className.split(' ')[0]);
    expect(order).toEqual(['timeline-scrubber-commit']);
    const row = info.querySelector('.timeline-scrubber-commit')!;
    expect(Array.from(row.children).map((c) => c.className)).toEqual([
      'timeline-scrubber-sha',
      'timeline-scrubber-subject',
    ]);
    expect(info.querySelector('.timeline-scrubber-subject')!.textContent).toBe('head');
  });

  // A commit belongs to its own day. Carrying it along made the message snap
  // between commits while the date moved smoothly, and named undrawn trees.
  it('shows the commit only on the day it happened', async () => {
    city.timeline.setPosition(1); // parked on the Feb 1 commit
    mount();
    await flush();
    expect(container.querySelector('.timeline-scrubber-sha')!.textContent).toBe(
      mid.sha.slice(0, 7)
    );
    expect(container.querySelector('.timeline-scrubber-subject')!.textContent).toBe('middle');
  });

  it('says so on a day with no commit, rather than carrying the last one along', async () => {
    city.timeline.setPosition(0.9); // late January, weeks past the Jan 1 commit
    mount();
    await flush();
    expect(container.querySelector('.timeline-scrubber-sha')).toBeNull();
    expect(container.querySelector('.timeline-scrubber-nocommit')).not.toBeNull();
  });

  // The date follows the handle rather than snapping to the nearest commit, so
  // dragging through a quiet stretch reads as days passing.
  it('shows the day the handle sits on, even alongside a commit', async () => {
    city.timeline.setPosition(0.5); // midway between Jan 1 and Feb 1
    mount();
    await flush();
    const shown = container.querySelector('.timeline-scrubber-date')!.textContent;
    expect(shown).not.toBe('Jan 1, 2026');
    expect(shown).toMatch(/Jan 1[5-9], 2026|Jan 2\d, 2026/);
  });

  it('shows the interpolated date + "no commits" when scrubbed into a gap', async () => {
    city.timeline.setPosition(1.5); // halfway between the Feb 1 and Mar 1 commits (a >2-day gap)
    mount();
    await flush();
    const nocommit = container.querySelector('.timeline-scrubber-nocommit');
    expect(nocommit).not.toBeNull();
    expect(nocommit!.textContent).toBe('no commits');
    // No sha shown, and the date is the interpolated mid-gap day (Feb), not a commit.
    expect(container.querySelector('.timeline-scrubber-sha')).toBeNull();
    expect(container.querySelector('.timeline-scrubber-date')!.textContent).toContain('Feb');
  });

  it('single-commit repo: handle pins right, track is inert (no drag)', async () => {
    const [only] = buildCommits({ date: '2026-07-24', files: 1, subject: 'init' });
    city.timeline.setBundle({
      commits: [only],
      unionManifest: { tree: { name: 'r' }, repo: { remote_url: null } },
      deltas: [],
      blobLines: {},
      blobSizes: {},
      notes: [],
      note: null,
    } as unknown as TimelineBundle);
    city.timeline.setPosition(0);
    mount();
    await flush();

    const t = track(container);
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(t.getAttribute('tabindex')).toBe('-1');
    expect(t.classList.contains('is-inert')).toBe(true);
    // Handle at the present (far right), not the left.
    expect(container.querySelector<HTMLElement>('.timeline-scrubber-handle')!.style.left).toBe(
      '100%'
    );

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
    expect(city.timeline.pos).toBe(0);
  });

  it('same-day repo stays scrubbable: track is live, a press moves SCRUB_POS', async () => {
    const day = '2026-07-24';
    city.timeline.setBundle({
      commits: buildCommits(
        { date: day, files: 1, subject: 'c1' },
        { date: day, files: 1, subject: 'c2' },
        { date: day, files: 1, subject: 'c3' }
      ),
      unionManifest: { tree: { name: 'r' }, repo: { remote_url: null } },
      deltas: [],
      blobLines: {},
      blobSizes: {},
      notes: [],
      note: null,
    } as unknown as TimelineBundle);
    city.timeline.setPosition(2);
    mount();
    await flush();

    const t = track(container);
    expect(t.getAttribute('aria-disabled')).toBe('false');
    expect(t.classList.contains('is-inert')).toBe(false);
    // Handle starts at the present (right), not collapsed to the left.
    expect(container.querySelector<HTMLElement>('.timeline-scrubber-handle')!.style.left).toBe(
      '100%'
    );

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
    expect(city.timeline.pos).toBe(0);
  });

  it('tracks a scrub driven from outside the component', async () => {
    city.timeline.setPosition(0);
    mount();
    await drainAsync();

    // The city batches its reports to a microtask and Preact re-renders off
    // that, so a single 0ms flush races them under parallel load.
    city.timeline.setPosition(1);
    await drainAsync();

    expect(track(container).getAttribute('aria-valuenow')).toBe('1');
    expect(container.querySelector('.timeline-scrubber-sha')!.textContent).toBe(
      mid.sha.slice(0, 7)
    );
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
    const ticks = () =>
      container.querySelector<HTMLCanvasElement>('canvas.timeline-scrubber-ticks');
    try {
      mount();
      await drainAsync(3, 20); // useEffect lands on rAF, which jsdom runs at ~16ms
      const first = ticks()!;
      expect(first.width).toBe(200);

      // The mode alone, not resetTimelineMode: this is about re-entering on
      // deps that did NOT change, so the bundle and position have to survive.
      city.timeline.setMode(false);
      await drainAsync(3, 20); // useEffect lands on rAF, which jsdom runs at ~16ms
      expect(ticks()).toBeNull();

      city.timeline.enter(); // same bundle, same position: no dep changes
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

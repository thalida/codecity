import { describe, it, expect, afterEach } from 'vitest';
import { showTooltip, hideTooltip, moveTooltip } from '@/city/scene/interaction/tooltip/tooltip';
import type { TooltipContent } from '@/city/scene/interaction/tooltip/text';

function content(partial: Partial<TooltipContent> = {}): TooltipContent {
  return { title: 'hello.ts', stats: [], deleted: false, ...partial };
}

describe('tooltip', () => {
  afterEach(() => {
    const el = document.getElementById('hover-tooltip');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  it('showTooltip creates a #hover-tooltip element with the title', () => {
    showTooltip(content(), 100, 200);
    const el = document.getElementById('hover-tooltip')!;
    expect(el).not.toBeNull();
    expect(el.querySelector('.tooltip-title')!.textContent).toBe('hello.ts');
    expect(el.style.display).toBe('block');
  });

  it('stacks the path and stats as their own lines', () => {
    showTooltip(content({ path: '/repo/app', stats: ['typescript', '50 lines'] }), 0, 0);
    const el = document.getElementById('hover-tooltip')!;
    expect(el.querySelector('.tooltip-path')!.textContent).toBe('/repo/app');
    expect(el.querySelector('.tooltip-stats')!.textContent).toContain('typescript');
    expect(el.querySelector('.tooltip-stats')!.textContent).toContain('50 lines');
  });

  it('omits the path and stats lines when there is nothing to put in them', () => {
    showTooltip(content(), 0, 0);
    const el = document.getElementById('hover-tooltip')!;
    expect(el.querySelector('.tooltip-path')).toBeNull();
    expect(el.querySelector('.tooltip-stats')).toBeNull();
  });

  it('leads a ruin with the deleted badge', () => {
    showTooltip(content({ deleted: true }), 0, 0);
    const el = document.getElementById('hover-tooltip')!;
    const badge = el.querySelector('.tooltip-deleted')!;
    expect(badge.textContent).toBe('deleted');
    expect(el.querySelector('.tooltip-title')!.contains(badge)).toBe(true);
  });

  it('showTooltip positions near the cursor with a default offset', () => {
    showTooltip(content({ title: 'foo' }), 50, 60);
    const el = document.getElementById('hover-tooltip')!;
    expect(el.style.left).toBe('64px'); // 50 + 14
    expect(el.style.top).toBe('74px'); // 60 + 14
  });

  // Regression: flipping to the other side of the cursor was the only clamp, so
  // a card too wide to fit on either side was pushed off the opposite edge.
  // Reproducing it needs a card wider than half the viewport, with the cursor
  // far enough right that the flip fires.
  it('never positions the card off the left or top edge', () => {
    showTooltip(content(), 5, 5);
    const el = document.getElementById('hover-tooltip')!;
    const wide = window.innerWidth - 120;
    const tall = window.innerHeight - 120;
    Object.defineProperty(el, 'offsetWidth', { value: wide, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: tall, configurable: true });

    // Mid-viewport: far enough right that the flip fires, but with less room to
    // the left than the card needs, so the flip lands off-screen.
    moveTooltip(window.innerWidth / 2, window.innerHeight / 2);
    expect(parseFloat(el.style.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(el.style.top)).toBeGreaterThanOrEqual(0);
  });

  it('moveTooltip before showTooltip does not conjure a tooltip', () => {
    moveTooltip(10, 20);
    expect(document.getElementById('hover-tooltip')).toBeNull();
  });

  it('hideTooltip sets display:none', () => {
    showTooltip(content({ title: 'x' }), 0, 0);
    hideTooltip();
    const el = document.getElementById('hover-tooltip')!;
    expect(el.style.display).toBe('none');
  });

  it('reuses the same element across multiple shows', () => {
    showTooltip(content({ title: 'first' }), 0, 0);
    const first = document.getElementById('hover-tooltip');
    showTooltip(content({ title: 'second' }), 0, 0);
    const second = document.getElementById('hover-tooltip')!;
    expect(first).toBe(second);
    expect(second.querySelector('.tooltip-title')!.textContent).toBe('second');
  });
});

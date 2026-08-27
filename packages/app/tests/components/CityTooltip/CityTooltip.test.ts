import { describe, it, expect, afterEach } from 'vitest';
import { createCityTooltip, type CityTooltip } from '@/components/CityTooltip/CityTooltip';
import type { TooltipContent } from '@/components/CityTooltip/tooltipContent';

function content(partial: Partial<TooltipContent> = {}): TooltipContent {
  return { title: 'hello.ts', stats: [], deleted: false, ...partial };
}

describe('CityTooltip', () => {
  let canvas: HTMLElement;
  let tooltip: CityTooltip;

  function mount(): HTMLElement {
    canvas = document.createElement('div');
    document.body.appendChild(canvas);
    tooltip = createCityTooltip(canvas);
    return canvas;
  }

  /** Move the pointer over the canvas, which is where the card takes its
   *  position from: the city reports what is under it, never where. */
  function pointTo(x: number, y: number): void {
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  }

  const el = () => document.getElementById('hover-tooltip')!;

  afterEach(() => {
    tooltip?.dispose();
    canvas?.remove();
  });

  it('show() fills a #hover-tooltip element with the title', () => {
    mount();
    tooltip.show(content());
    expect(el()).not.toBeNull();
    expect(el().querySelector('.tooltip-title')!.textContent).toBe('hello.ts');
    expect(el().style.display).toBe('block');
  });

  it('stacks the path and stats as their own lines', () => {
    mount();
    tooltip.show(content({ path: '/repo/app', stats: ['typescript', '50 lines'] }));
    expect(el().querySelector('.tooltip-path')!.textContent).toBe('/repo/app');
    expect(el().querySelector('.tooltip-stats')!.textContent).toContain('typescript');
    expect(el().querySelector('.tooltip-stats')!.textContent).toContain('50 lines');
  });

  it('omits the path and stats lines when there is nothing to put in them', () => {
    mount();
    tooltip.show(content());
    expect(el().querySelector('.tooltip-path')).toBeNull();
    expect(el().querySelector('.tooltip-stats')).toBeNull();
  });

  it('leads a ruin with the deleted badge', () => {
    mount();
    tooltip.show(content({ deleted: true }));
    const badge = el().querySelector('.tooltip-deleted')!;
    expect(badge.textContent).toBe('deleted');
    expect(el().querySelector('.tooltip-title')!.contains(badge)).toBe(true);
  });

  it('sits near the cursor at a default offset', () => {
    mount();
    pointTo(50, 60);
    tooltip.show(content({ title: 'foo' }));
    expect(el().style.left).toBe('64px'); // 50 + 14
    expect(el().style.top).toBe('74px'); // 60 + 14
  });

  it('follows the cursor while it is showing', () => {
    mount();
    pointTo(50, 60);
    tooltip.show(content());
    pointTo(120, 130);
    expect(el().style.left).toBe('134px');
    expect(el().style.top).toBe('144px');
  });

  // Regression: flipping to the other side of the cursor was the only clamp, so
  // a card too wide to fit on either side was pushed off the opposite edge.
  // Reproducing it needs a card wider than half the viewport, with the cursor
  // far enough right that the flip fires.
  it('never positions the card off the left or top edge', () => {
    mount();
    tooltip.show(content());
    const wide = window.innerWidth - 120;
    const tall = window.innerHeight - 120;
    Object.defineProperty(el(), 'offsetWidth', { value: wide, configurable: true });
    Object.defineProperty(el(), 'offsetHeight', { value: tall, configurable: true });

    // Mid-viewport: far enough right that the flip fires, but with less room to
    // the left than the card needs, so the flip lands off-screen.
    pointTo(window.innerWidth / 2, window.innerHeight / 2);
    expect(parseFloat(el().style.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(el().style.top)).toBeGreaterThanOrEqual(0);
  });

  it('show(null) hides it', () => {
    mount();
    tooltip.show(content({ title: 'x' }));
    tooltip.show(null);
    expect(el().style.display).toBe('none');
  });

  it('reuses the same element across multiple shows', () => {
    mount();
    tooltip.show(content({ title: 'first' }));
    const first = el();
    tooltip.show(content({ title: 'second' }));
    expect(first).toBe(el());
    expect(el().querySelector('.tooltip-title')!.textContent).toBe('second');
  });

  // Two cities on one page would otherwise leave a card behind on unmount, and
  // the survivor would keep tracking a canvas that no longer exists.
  it('dispose() takes its element and its listener with it', () => {
    mount();
    tooltip.show(content());
    tooltip.dispose();
    expect(document.getElementById('hover-tooltip')).toBeNull();
  });

  it('gives each canvas its own card', () => {
    const a = createCityTooltip(document.createElement('div'));
    const b = createCityTooltip(document.createElement('div'));
    a.show(content({ title: 'scene' }));
    b.show(content({ title: 'backdrop' }));
    const cards = document.querySelectorAll('#hover-tooltip');
    expect(cards).toHaveLength(2);
    a.dispose();
    b.dispose();
  });
});

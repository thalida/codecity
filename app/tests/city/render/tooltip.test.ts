import { describe, it, expect, afterEach } from 'vitest';
import { showTooltip, hideTooltip, moveTooltip } from '@/city/render/tooltip';

describe('tooltip', () => {
  afterEach(() => {
    const el = document.getElementById('hover-tooltip');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  it('showTooltip creates a #hover-tooltip element with the text', () => {
    showTooltip('hello.ts', 100, 200);
    const el = document.getElementById('hover-tooltip')!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('hello.ts');
    expect(el.style.display).toBe('block');
  });

  it('showTooltip positions near the cursor with a default offset', () => {
    showTooltip('foo', 50, 60);
    const el = document.getElementById('hover-tooltip')!;
    expect(el.style.left).toBe('64px'); // 50 + 14
    expect(el.style.top).toBe('74px'); // 60 + 14
  });

  it('moveTooltip is safe before showTooltip (no-op)', () => {
    expect(() => moveTooltip(10, 20)).not.toThrow();
  });

  it('hideTooltip sets display:none', () => {
    showTooltip('x', 0, 0);
    hideTooltip();
    const el = document.getElementById('hover-tooltip')!;
    expect(el.style.display).toBe('none');
  });

  it('reuses the same element across multiple shows', () => {
    showTooltip('first', 0, 0);
    const first = document.getElementById('hover-tooltip');
    showTooltip('second', 0, 0);
    const second = document.getElementById('hover-tooltip')!;
    expect(first).toBe(second);
    expect(second.textContent).toBe('second');
  });
});

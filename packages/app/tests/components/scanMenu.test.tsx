import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { ScanMenu } from '@/features/city/components/ScanMenu/ScanMenu';
import { CURRENT_SOURCE } from '@/state/source';
import { EXCLUDES, addExclude, clearExcludes } from '@/state/excludes';
import { LIVE_UPDATES } from '@/features/settings/state/values/updates';
import { drainAsync, flush } from '../_helpers/preact';
import { popoverPanel } from '../_helpers/popover';

// Preact schedules useEffect on rAF, which jsdom fires around 16ms, so the open
// effect (registering the dismiss listeners) needs a real timer yield.
const settleEffects = () => drainAsync(3, 20);

describe('ScanMenu', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = { src: '/repos/codecity', branch: undefined };
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    CURRENT_SOURCE.value = null;
  });

  const trigger = () => container.querySelector('.scan-menu-trigger') as HTMLButtonElement;
  const panel = popoverPanel;
  const open = async () => {
    trigger().click();
    await flush();
  };

  it('makes the freshness readout the trigger, not a label beside one', async () => {
    render(<ScanMenu />, container);
    await flush();

    // The complaint this resolves: the dot and its age used to look pressable
    // and do nothing.
    expect(trigger().querySelector('.freshness-status')).not.toBeNull();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
  });

  it('announces status from a live region outside the button', async () => {
    render(<ScanMenu />, container);
    await flush();

    // A button's contents are only read on focus, so the status has to live in
    // a standalone node to be announced at all.
    const live = container.querySelector('[role="status"]')!;
    expect(live).not.toBeNull();
    expect(trigger().contains(live)).toBe(false);
  });

  // Hiding a building closes the pane and removes the building, so without this
  // the only trace of what you did is missing geometry.
  it('marks the trigger with how many paths are hidden, and drops the mark at none', async () => {
    render(<ScanMenu />, container);
    await flush();
    expect(trigger().querySelector('.scan-menu-count')).toBeNull();

    addExclude('vendor');
    await flush();
    expect(trigger().querySelector('.scan-menu-count')!.textContent).toBe('1');

    addExclude('a.md');
    await flush();
    expect(trigger().querySelector('.scan-menu-count')!.textContent).toBe('2');

    clearExcludes();
    await flush();
    expect(trigger().querySelector('.scan-menu-count')).toBeNull();
  });

  it('carries the hidden count into the name and the live region, singular and plural', async () => {
    render(<ScanMenu />, container);
    await flush();
    const live = () => container.querySelector('[role="status"]')!;
    expect(live().textContent).not.toMatch(/hidden/);

    addExclude('vendor');
    await flush();
    expect(live().textContent).toMatch(/1 path hidden$/);
    expect(trigger().getAttribute('aria-label')).toMatch(/1 path hidden$/);

    addExclude('a.md');
    await flush();
    expect(live().textContent).toMatch(/2 paths hidden$/);
  });

  // The chip is already on screen when the second path is hidden, so the ring
  // only replays if something restarts it (useReplayAnimation).
  it('replays the pulse when the count changes', async () => {
    addExclude('vendor');
    render(<ScanMenu />, container);
    await flush();

    const chip = trigger().querySelector('.scan-menu-count') as HTMLElement;
    // oldValue, not the live attribute: the records arrive on a microtask, by
    // which time the restart has already put the style back.
    const seen: string[] = [];
    const observer = new MutationObserver((records) =>
      records.forEach((r) => seen.push(r.oldValue ?? ''))
    );
    observer.observe(chip, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    });

    addExclude('a.md');
    await flush();
    observer.disconnect();

    // Cleared, reflowed, restored: the animation runs from the top again.
    expect(seen.some((s) => s.includes('animation: none'))).toBe(true);
    expect(chip.getAttribute('style')).toBe('');
  });

  it('opens the panel and marks itself expanded', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();

    expect(panel()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  // Mixed content: a role="menu" takes only menuitems, so a form control in
  // here would be unreachable for a screen reader following menu semantics.
  it('is a dialog rather than a menu, and carries no menuitems', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();

    expect(panel()!.querySelector('[role="menu"]')).toBeNull();
    expect(panel()!.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });

  // The cache flag is the only difference between them, so the panel is where
  // that choice belongs rather than split across a button and a menu.
  const ACTION_CASES: Array<[label: string, index: number, skipCache: boolean]> = [
    ['Reload', 0, false],
    ['Fresh scan', 1, true],
  ];
  it.each(ACTION_CASES)('runs %s and closes the panel', async (label, index, skipCache) => {
    const onRefresh = vi.fn();
    render(<ScanMenu onRefresh={onRefresh} />, container);
    await flush();
    await open();

    const actions = panel()!.querySelectorAll<HTMLButtonElement>('.scan-menu-action');
    expect(actions).toHaveLength(2);
    expect(actions[index].querySelector('.scan-menu-action-label')!.textContent).toBe(label);

    actions[index].click();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(skipCache);
    expect(panel()).toBeNull();
  });

  it('holds the auto-refresh settings that used to live in the Scan tab', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();

    const labels = Array.from(panel()!.querySelectorAll('.setting-row-label')).map(
      (el) => el.textContent
    );
    expect(labels).toEqual(['Auto-refresh', 'Poll interval (s)']);
  });

  // A paragraph under every control outweighs the controls in a panel this
  // size, so the tip survives as the row's hover title and for AT only.
  it('keeps field tips off the surface but reachable', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();

    expect(panel()!.querySelector('.setting-row-desc')).toBeNull();
    const row = panel()!.querySelector('.setting-row-main')!;
    expect(row.getAttribute('title')).toContain('Auto-refresh:');
  });

  it('writes an auto-refresh change straight through, with no Save step', async () => {
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true };
    render(<ScanMenu />, container);
    await flush();
    await open();

    const toggle = panel()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    toggle.click();
    await flush();
    expect(LIVE_UPDATES.value.ENABLED).toBe(false);
  });

  it('says the poll only applies to local projects when the source is a clone', async () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/thalida/codecity', branch: undefined };
    render(<ScanMenu />, container);
    await flush();
    await open();

    expect(panel()!.textContent).toMatch(/local projects only/i);
  });

  it('lists active excludes and restores one on click', async () => {
    addExclude('vendor');
    addExclude('a.md');
    render(<ScanMenu />, container);
    await flush();
    await open();

    expect(panel()!.textContent).toContain('vendor');
    expect(panel()!.textContent).toContain('a.md');

    panel()!.querySelector<HTMLButtonElement>('button[aria-label="Restore vendor"]')!.click();
    await flush(); // signal-driven re-render is microtask-scheduled
    expect(panel()!.textContent).not.toContain('vendor');
  });

  it('restores every exclude at once', async () => {
    addExclude('vendor');
    addExclude('a.md');
    render(<ScanMenu />, container);
    await flush();
    await open();

    panel()!
      .querySelector<HTMLButtonElement>('button[aria-label="Restore all excluded paths"]')!
      .click();
    await flush();
    expect(panel()!.textContent).toMatch(/nothing hidden from the city/i);
  });

  it('drops the restore-all control when there is nothing to restore', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();

    expect(panel()!.textContent).toMatch(/nothing hidden from the city/i);
    // A permanently disabled control is noise in a panel this small.
    expect(panel()!.querySelector('button[aria-label="Restore all excluded paths"]')).toBeNull();
    expect(container.querySelector('.scan-menu-count')).toBeNull();
  });

  it('Escape closes it and returns focus to the trigger', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();
    await settleEffects();

    panel()!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('a pointer press outside closes it', async () => {
    render(<ScanMenu />, container);
    await flush();
    await open();
    await settleEffects();

    document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    await flush();
    expect(panel()).toBeNull();
  });

  // The panel is portaled out of the trigger's tree, so a containment check
  // against one root would treat a press inside the panel as an outside press.
  it('a press inside the panel leaves it open', async () => {
    addExclude('vendor');
    render(<ScanMenu />, container);
    await flush();
    await open();
    await settleEffects();

    panel()!.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    await flush();
    expect(panel()).not.toBeNull();
  });
});

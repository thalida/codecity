import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSourcePicker } from '../../views/shell/sourcePicker.js';
import { pushRecent } from '../../views/shell/sourceRecents.js';

function mountRoot(): HTMLElement {
  document.body.innerHTML =
    '<div id="source-picker-root" style="display: none;"></div>';
  return document.getElementById('source-picker-root')!;
}

describe('sourcePicker', () => {
  let root: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    root = mountRoot();
    history.replaceState(null, '', '/');
  });

  it('starts hidden', () => {
    createSourcePicker({ onSubmit: () => {} });
    expect(root.style.display).toBe('none');
  });

  it('open() renders the modal', () => {
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open();
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain('Open project');
  });

  it('switches tabs', () => {
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open();
    const gitTab = root.querySelector('[data-tab="git"]') as HTMLButtonElement;
    gitTab.click();
    expect(gitTab.classList.contains('active')).toBe(true);
    // Git URL input visible
    expect(root.querySelector('[data-field="url"]')).toBeTruthy();
    // Branch input visible
    expect(root.querySelector('[data-field="branch"]')).toBeTruthy();
  });

  it('submit fires onSubmit with the typed src', () => {
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit });
    p.open();
    const input = root.querySelector('[data-field="path"]') as HTMLInputElement;
    input.value = '/Users/foo/bar';
    (root.querySelector('button.submit') as HTMLButtonElement).click();
    expect(onSubmit).toHaveBeenCalledWith({ src: '/Users/foo/bar', branch: undefined });
  });

  it('git-tab submit includes branch', () => {
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit });
    p.open();
    (root.querySelector('[data-tab="git"]') as HTMLButtonElement).click();
    (root.querySelector('[data-field="url"]') as HTMLInputElement).value
      = 'https://github.com/o/r';
    (root.querySelector('[data-field="branch"]') as HTMLInputElement).value
      = 'main';
    (root.querySelector('button.submit') as HTMLButtonElement).click();
    expect(onSubmit).toHaveBeenCalledWith({
      src: 'https://github.com/o/r',
      branch: 'main',
    });
  });

  it('renders recents', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open();
    const rows = root.querySelectorAll('.recent-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('x/r'); // MRU first
  });

  it('recent-row click submits with the row payload', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit });
    p.open();
    (root.querySelector('.recent-row') as HTMLElement).click();
    expect(onSubmit).toHaveBeenCalledWith({ src: '/foo', branch: undefined });
  });

  it('shows error banner when open() includes error', () => {
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open({ error: 'repository not found at xyz' });
    expect(root.textContent).toContain('repository not found at xyz');
  });

  it('non-dismissible: no × button, Escape ignored, backdrop click ignored', () => {
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open({ dismissible: false });
    expect(root.querySelector('[data-action="close"]')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.style.display).not.toBe('none');

    (root.querySelector('.modal-backdrop') as HTMLElement).click();
    expect(root.style.display).not.toBe('none');
  });

  it('dismissible: × / Escape / backdrop all close', () => {
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open({ dismissible: true });
    expect(root.querySelector('[data-action="close"]')).toBeTruthy();

    (root.querySelector('[data-action="close"]') as HTMLButtonElement).click();
    expect(root.style.display).toBe('none');

    p.open({ dismissible: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.style.display).toBe('none');

    p.open({ dismissible: true });
    (root.querySelector('.modal-backdrop') as HTMLElement).click();
    expect(root.style.display).toBe('none');
  });

  it('prefill populates inputs', () => {
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open({ prefill: { src: 'https://github.com/o/r', branch: 'develop' } });
    expect(
      (root.querySelector('[data-tab="git"]') as HTMLButtonElement)
        .classList.contains('active')
    ).toBe(true);
    expect((root.querySelector('[data-field="url"]') as HTMLInputElement).value)
      .toBe('https://github.com/o/r');
    expect((root.querySelector('[data-field="branch"]') as HTMLInputElement).value)
      .toBe('develop');
  });

  it('marks the currently-loaded recent as active', () => {
    history.replaceState(null, '', '?src=%2Ffoo');
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    const p = createSourcePicker({ onSubmit: () => {} });
    p.open();
    const activeRow = root.querySelector('.recent-row--active');
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('/foo');
  });

  it('active row click is a no-op', () => {
    history.replaceState(null, '', '?src=%2Ffoo');
    pushRecent({ src: '/foo', label: 'foo' });
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit });
    p.open();
    (root.querySelector('.recent-row--active') as HTMLElement).click();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSourcePicker } from '@/views/source/sourcePicker.js';
import { pushRecent } from '@/views/source/sourceRecents.js';

function mountRoot(): HTMLElement {
  document.body.innerHTML = '<div id="source-picker-root" style="display: none;"></div>';
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
    createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    expect(root.style.display).toBe('none');
  });

  it('open() renders the modal', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open();
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain('Open project');
  });

  it('switches tabs', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
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
    const p = createSourcePicker({ onSubmit, allowLocalRepos: true });
    p.open();
    // Default tab is "git"; switch to local before setting the path field.
    (root.querySelector('[data-tab="local"]') as HTMLButtonElement).click();
    const input = root.querySelector('[data-field="path"]') as HTMLInputElement;
    input.value = '/Users/foo/bar';
    (root.querySelector('button.submit') as HTMLButtonElement).click();
    // Full payload: submitFromForm always emits all three keys (undefined
    // for absent inputs). Asserting the complete shape catches regressions
    // where a future change accidentally starts including extra fields.
    expect(onSubmit).toHaveBeenCalledWith({
      src: '/Users/foo/bar',
      branch: undefined,
      skipCache: undefined,
    });
  });

  it('git-tab submit includes branch', () => {
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit, allowLocalRepos: true });
    p.open();
    (root.querySelector('[data-tab="git"]') as HTMLButtonElement).click();
    (root.querySelector('[data-field="url"]') as HTMLInputElement).value = 'https://github.com/o/r';
    (root.querySelector('[data-field="branch"]') as HTMLInputElement).value = 'main';
    (root.querySelector('button.submit') as HTMLButtonElement).click();
    expect(onSubmit).toHaveBeenCalledWith({
      src: 'https://github.com/o/r',
      branch: 'main',
      skipCache: undefined,
    });
  });

  it('renders recents', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open();
    const rows = root.querySelectorAll('.recent-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('x/r'); // MRU first
  });

  it('recent-row click submits with the row payload', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit, allowLocalRepos: true });
    p.open();
    (root.querySelector('.recent-row') as HTMLElement).click();
    // Recent-row clicks omit skipCache entirely (it's only set on fresh-
    // form submits via the checkbox), so the payload has 2 keys.
    expect(onSubmit).toHaveBeenCalledWith({
      src: '/foo',
      branch: undefined,
    });
  });

  it('shows error banner when open() includes error', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open({ error: 'repository not found at xyz' });
    expect(root.textContent).toContain('repository not found at xyz');
  });

  it('non-dismissible: no × button, Escape ignored, backdrop click ignored', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open({ dismissible: false });
    expect(root.querySelector('[data-action="close"]')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.style.display).not.toBe('none');

    (root.querySelector('.modal-backdrop') as HTMLElement).click();
    expect(root.style.display).not.toBe('none');
  });

  it('dismissible: × / Escape / backdrop all close', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
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
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open({ prefill: { src: 'https://github.com/o/r', branch: 'develop' } });
    expect(
      (root.querySelector('[data-tab="git"]') as HTMLButtonElement).classList.contains('active')
    ).toBe(true);
    expect((root.querySelector('[data-field="url"]') as HTMLInputElement).value).toBe(
      'https://github.com/o/r'
    );
    expect((root.querySelector('[data-field="branch"]') as HTMLInputElement).value).toBe('develop');
  });

  it('marks the currently-loaded recent as active', () => {
    history.replaceState(null, '', '?src=%2Ffoo');
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open();
    const activeRow = root.querySelector('.recent-row--active');
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('/foo');
  });

  it('active row click is a no-op', () => {
    history.replaceState(null, '', '?src=%2Ffoo');
    pushRecent({ src: '/foo', label: 'foo' });
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit, allowLocalRepos: true });
    p.open();
    (root.querySelector('.recent-row--active') as HTMLElement).click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ── allowLocalRepos: false ──────────────────────────────────────────

  it('disabled: renders a warning card in the Local pane instead of the input', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: false });
    p.open();
    (root.querySelector('[data-tab="local"]') as HTMLButtonElement).click();
    // Path input is GONE.
    expect(root.querySelector('[data-field="path"]')).toBeNull();
    // Warning card is present, with the env-var name and the docs link.
    const warning = root.querySelector('[data-pane="local"] .modal-warning');
    expect(warning).toBeTruthy();
    expect(warning?.textContent).toContain('CODECITY_ALLOW_LOCAL_REPOS');
    const link = warning?.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.href).toContain('github.com/thalida/codecity');
  });

  it('disabled: default tab is git even when prefill is a local path', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: false });
    p.open({ prefill: { src: '/Users/foo/bar' } });
    const gitTab = root.querySelector('[data-tab="git"]') as HTMLButtonElement;
    expect(gitTab.classList.contains('active')).toBe(true);
  });

  it('disabled: local recents render with warning badge + dimmed class', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: 'https://github.com/o/r', branch: 'main', label: 'o/r' });
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: false });
    p.open();
    const rows = root.querySelectorAll('.recent-row');
    // Order is MRU: o/r first (git, normal), /foo second (local, disabled).
    expect(rows[0].classList.contains('recent-row--disabled')).toBe(false);
    expect(rows[1].classList.contains('recent-row--disabled')).toBe(true);
    expect(rows[1].querySelector('.recent-icon')?.textContent).toContain('⚠');
    expect((rows[1] as HTMLElement).title).toContain('Local repos are disabled');
  });

  it('disabled: clicking a disabled local recent is a no-op', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const onSubmit = vi.fn();
    const p = createSourcePicker({ onSubmit, allowLocalRepos: false });
    p.open();
    (root.querySelector('.recent-row--disabled') as HTMLElement).click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disabled: trash on a disabled local recent still works', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Stub fetch so the best-effort cache-clear DELETE doesn't blow up.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: false });
    p.open();
    const removeBtn = root.querySelector('[data-action="recent-remove"]') as HTMLButtonElement;
    removeBtn.click();
    // Row should be gone after re-render.
    expect(root.querySelectorAll('.recent-row').length).toBe(0);
    confirmSpy.mockRestore();
  });

  it('disabled: form fields (history/skip/submit) are hidden on the Local pane', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: false });
    p.open();
    // Default opens on Git tab; switch to Local.
    (root.querySelector('[data-tab="local"]') as HTMLButtonElement).click();
    const formFields = root.querySelector('[data-form-fields]') as HTMLElement;
    expect(formFields).toBeTruthy();
    expect(formFields.style.display).toBe('none');
  });

  it('disabled: switching back to Git tab reveals the form fields again', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: false });
    p.open();
    (root.querySelector('[data-tab="local"]') as HTMLButtonElement).click();
    (root.querySelector('[data-tab="git"]') as HTMLButtonElement).click();
    const formFields = root.querySelector('[data-form-fields]') as HTMLElement;
    expect(formFields.style.display).not.toBe('none');
    // Submit button is back in the DOM and clickable.
    expect(root.querySelector('button.submit')).toBeTruthy();
  });

  it('enabled: form fields render on the Local pane (regression guard)', () => {
    const p = createSourcePicker({ onSubmit: () => {}, allowLocalRepos: true });
    p.open();
    (root.querySelector('[data-tab="local"]') as HTMLButtonElement).click();
    const formFields = root.querySelector('[data-form-fields]') as HTMLElement;
    expect(formFields.style.display).not.toBe('none');
  });
});

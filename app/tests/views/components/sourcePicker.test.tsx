import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import {
  SourcePickerComponent,
  SourceTab,
  inferSourceTab,
} from '@/views/components/SourcePicker';
import type { SourcePickerState, SourcePayload, OpenOpts } from '@/views/components/SourcePicker';
import { pushRecent, RECENTS } from '@/state/runtime/sourceRecents';
import { flush } from '../../_helpers/preact';

describe('SourcePicker', () => {
  let container: HTMLDivElement;
  let onSubmit: (s: SourcePayload) => void;
  let onClose: () => void;
  let state: ReturnType<typeof signal<SourcePickerState>>;
  let allowLocalRepos = true;

  // Mirrors the factory's createSourcePicker({ onSubmit, allowLocalRepos }):
  // build a fresh state signal (closed) and render the component into a
  // container. The factory mounted into #source-picker-root; the component
  // takes a container we own here.
  function createPicker(opts: { allowLocalRepos: boolean }): void {
    allowLocalRepos = opts.allowLocalRepos;
    // "Closed" = nothing mounted, mirroring the production wrapper which renders
    // null when the picker isn't visible. open() mounts the component.
    state = signal<SourcePickerState>({
      dismissible: false,
      activeTab: SourceTab.Git,
      prefillSrc: '',
      prefillBranch: '',
      error: null,
      allowLocalRepos,
    });
  }

  // Maps the factory's `.open(opts)` onto a mount. The component's form inputs
  // are useState-backed and seeded on MOUNT from state, so to get fresh inputs
  // each open() we unmount (render null) then mount fresh — mirroring the
  // production wrapper, which renders null when the picker is closed.
  async function open(opts: OpenOpts = {}): Promise<void> {
    const prefillSrc = opts.prefill?.src ?? '';
    // Tab derivation mirrors the factory's deriveTabFromPrefill: a prefill
    // source picks its tab via inferSourceTab, BUT when local repos are
    // disabled we never default to the Local tab.
    let activeTab: SourceTab;
    if (!prefillSrc) {
      activeTab = SourceTab.Git;
    } else if (!allowLocalRepos) {
      activeTab = SourceTab.Git;
    } else {
      activeTab = inferSourceTab(prefillSrc);
    }

    // Unmount any prior render so useState re-initialises on re-open (mirrors
    // the production wrapper returning null when closed), then mount fresh.
    act(() => render(null, container));
    await flush();
    state.value = {
      dismissible: opts.dismissible ?? false,
      activeTab,
      prefillSrc,
      prefillBranch: opts.prefill?.branch ?? '',
      error: opts.error ?? null,
      allowLocalRepos,
    };
    act(() => {
      render(<SourcePickerComponent state={state} onSubmit={onSubmit} onClose={onClose} />, container);
    });
    await flush();
  }

  // Set a controlled input's value the way the component expects: write the
  // DOM value then dispatch an `input` event so the onInput handler updates
  // the backing useState. act() flushes that state update synchronously.
  function setInput(sel: string, value: string): void {
    const input = container.querySelector(sel) as HTMLInputElement;
    input.value = value;
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  beforeEach(() => {
    localStorage.clear();
    // RECENTS persists at module load — reset in-memory value so each
    // test starts from an empty list.
    RECENTS.value = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    history.replaceState(null, '', '/');
    onSubmit = vi.fn();
    onClose = vi.fn();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('starts hidden', () => {
    createPicker({ allowLocalRepos: true });
    // Factory toggled root.style.display; the component returns null when
    // closed, so "hidden" means nothing was rendered.
    expect(container.querySelector('.modal-backdrop')).toBeNull();
  });

  it('open() renders the modal', async () => {
    createPicker({ allowLocalRepos: true });
    await open();
    expect(container.querySelector('.modal-backdrop')).not.toBeNull();
    expect(container.textContent).toContain('Open project');
  });

  it('switches tabs', async () => {
    createPicker({ allowLocalRepos: true });
    await open();
    const gitTab = container.querySelector('[data-tab="git"]') as HTMLButtonElement;
    act(() => gitTab.click());
    await flush();
    expect(gitTab.classList.contains('active')).toBe(true);
    // Git URL input visible
    expect(container.querySelector('[data-field="url"]')).toBeTruthy();
    // Branch input visible
    expect(container.querySelector('[data-field="branch"]')).toBeTruthy();
  });

  it('submit fires onSubmit with the typed src', async () => {
    createPicker({ allowLocalRepos: true });
    await open();
    // Default tab is "git"; switch to local before setting the path field.
    act(() => (container.querySelector('[data-tab="local"]') as HTMLButtonElement).click());
    await flush();
    setInput('[data-field="path"]', '/Users/foo/bar');
    act(() => (container.querySelector('button.submit') as HTMLButtonElement).click());
    // Full payload: handleSubmit always emits all three keys (undefined
    // for absent inputs). Asserting the complete shape catches regressions
    // where a future change accidentally starts including extra fields.
    expect(onSubmit).toHaveBeenCalledWith({
      src: '/Users/foo/bar',
      branch: undefined,
      skipCache: undefined,
    });
  });

  it('git-tab submit includes branch', async () => {
    createPicker({ allowLocalRepos: true });
    await open();
    act(() => (container.querySelector('[data-tab="git"]') as HTMLButtonElement).click());
    await flush();
    setInput('[data-field="url"]', 'https://github.com/o/r');
    setInput('[data-field="branch"]', 'main');
    act(() => (container.querySelector('button.submit') as HTMLButtonElement).click());
    expect(onSubmit).toHaveBeenCalledWith({
      src: 'https://github.com/o/r',
      branch: 'main',
      skipCache: undefined,
    });
  });

  it('renders recents', async () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    createPicker({ allowLocalRepos: true });
    await open();
    const rows = container.querySelectorAll('.recent-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('x/r'); // MRU first
  });

  it('recent-row click submits with the row payload', async () => {
    pushRecent({ src: '/foo', label: 'foo' });
    createPicker({ allowLocalRepos: true });
    await open();
    act(() => (container.querySelector('.recent-row') as HTMLElement).click());
    // Recent-row clicks omit skipCache entirely (handleRecentClick only
    // passes src + branch), so the payload has 2 keys.
    expect(onSubmit).toHaveBeenCalledWith({
      src: '/foo',
      branch: undefined,
    });
  });

  it('shows error banner when open() includes error', async () => {
    createPicker({ allowLocalRepos: true });
    await open({ error: 'repository not found at xyz' });
    expect(container.textContent).toContain('repository not found at xyz');
  });

  it('non-dismissible: no × button, Escape ignored, backdrop click ignored', async () => {
    createPicker({ allowLocalRepos: true });
    await open({ dismissible: false });
    expect(container.querySelector('[data-action="close"]')).toBeNull();

    // The component has no document keydown handler (the factory added one);
    // Escape simply does nothing. Assert the modal stays mounted.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(container.querySelector('.modal-backdrop')).not.toBeNull();

    // Backdrop click on a non-dismissible modal is ignored (guarded by
    // s.dismissible in the onClick). The component closes via onClose rather
    // than toggling display, so assert onClose was NOT called.
    act(() => (container.querySelector('.modal-backdrop') as HTMLElement).click());
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.modal-backdrop')).not.toBeNull();
  });

  it('dismissible: × / backdrop both close', async () => {
    createPicker({ allowLocalRepos: true });
    await open({ dismissible: true });
    expect(container.querySelector('[data-action="close"]')).toBeTruthy();

    // The component delegates closing to the onClose callback rather than
    // hiding the root itself (the factory set root.style.display='none').
    // Each close path is asserted by checking onClose fired.
    act(() => (container.querySelector('[data-action="close"]') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);

    await open({ dismissible: true });
    act(() => {
      const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
      backdrop.click(); // target === currentTarget → triggers close
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    // NOTE: the factory also closed on Escape; SourcePickerComponent has no
    // keydown listener, so the Escape branch of the original test is dropped
    // — there is no component behaviour to assert.
  });

  it('prefill populates inputs', async () => {
    createPicker({ allowLocalRepos: true });
    await open({ prefill: { src: 'https://github.com/o/r', branch: 'develop' } });
    expect(
      (container.querySelector('[data-tab="git"]') as HTMLButtonElement).classList.contains('active')
    ).toBe(true);
    expect((container.querySelector('[data-field="url"]') as HTMLInputElement).value).toBe(
      'https://github.com/o/r'
    );
    expect((container.querySelector('[data-field="branch"]') as HTMLInputElement).value).toBe(
      'develop'
    );
  });

  it('marks the currently-loaded recent as active', async () => {
    history.replaceState(null, '', '?src=%2Ffoo');
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    createPicker({ allowLocalRepos: true });
    await open();
    const activeRow = container.querySelector('.recent-row--active');
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('/foo');
  });

  it('active row click is a no-op', async () => {
    history.replaceState(null, '', '?src=%2Ffoo');
    pushRecent({ src: '/foo', label: 'foo' });
    createPicker({ allowLocalRepos: true });
    await open();
    act(() => (container.querySelector('.recent-row--active') as HTMLElement).click());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ── allowLocalRepos: false ──────────────────────────────────────────

  it('disabled: renders a warning card in the Local pane instead of the input', async () => {
    createPicker({ allowLocalRepos: false });
    await open();
    act(() => (container.querySelector('[data-tab="local"]') as HTMLButtonElement).click());
    await flush();
    // Path input is GONE.
    expect(container.querySelector('[data-field="path"]')).toBeNull();
    // Warning card is present, with the env-var name and the docs link.
    const warning = container.querySelector('[data-pane="local"] .modal-warning');
    expect(warning).toBeTruthy();
    expect(warning?.textContent).toContain('CODECITY_ALLOW_LOCAL_REPOS');
    const link = warning?.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.href).toContain('github.com/thalida/codecity');
  });

  it('disabled: default tab is git even when prefill is a local path', async () => {
    createPicker({ allowLocalRepos: false });
    await open({ prefill: { src: '/Users/foo/bar' } });
    const gitTab = container.querySelector('[data-tab="git"]') as HTMLButtonElement;
    expect(gitTab.classList.contains('active')).toBe(true);
  });

  it('disabled: local recents render with warning badge + dimmed class', async () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: 'https://github.com/o/r', branch: 'main', label: 'o/r' });
    createPicker({ allowLocalRepos: false });
    await open();
    const rows = container.querySelectorAll('.recent-row');
    // Order is MRU: o/r first (git, normal), /foo second (local, disabled).
    expect(rows[0].classList.contains('recent-row--disabled')).toBe(false);
    expect(rows[1].classList.contains('recent-row--disabled')).toBe(true);
    // Disabled (local) rows render the Lucide alert glyph (a mask-painted
    // .lucide-icon span); git rows render an inline brand <svg>.
    expect(rows[1].querySelector('.recent-icon .lucide-icon')).not.toBeNull();
    expect(rows[0].querySelector('.recent-icon svg')).not.toBeNull();
    expect((rows[1] as HTMLElement).title).toContain('Local repos are disabled');
  });

  it('disabled: clicking a disabled local recent is a no-op', async () => {
    pushRecent({ src: '/foo', label: 'foo' });
    createPicker({ allowLocalRepos: false });
    await open();
    act(() => (container.querySelector('.recent-row--disabled') as HTMLElement).click());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disabled: trash on a disabled local recent still works', async () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Stub fetch so the best-effort cache-clear DELETE doesn't blow up.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    createPicker({ allowLocalRepos: false });
    await open();
    const removeBtn = container.querySelector('[data-action="recent-remove"]') as HTMLButtonElement;
    // handleRecentRemove calls removeRecent (mutates RECENTS signal) then
    // writes state.value to force a re-render; flush lets Preact re-render.
    act(() => removeBtn.click());
    await flush();
    // Row should be gone after re-render.
    expect(container.querySelectorAll('.recent-row').length).toBe(0);
    confirmSpy.mockRestore();
  });

  it('disabled: form fields (history/skip/submit) are hidden on the Local pane', async () => {
    createPicker({ allowLocalRepos: false });
    await open();
    // Default opens on Git tab; switch to Local.
    act(() => (container.querySelector('[data-tab="local"]') as HTMLButtonElement).click());
    await flush();
    const formFields = container.querySelector('[data-form-fields]') as HTMLElement;
    expect(formFields).toBeTruthy();
    expect(formFields.style.display).toBe('none');
  });

  it('disabled: switching back to Git tab reveals the form fields again', async () => {
    createPicker({ allowLocalRepos: false });
    await open();
    act(() => (container.querySelector('[data-tab="local"]') as HTMLButtonElement).click());
    await flush();
    act(() => (container.querySelector('[data-tab="git"]') as HTMLButtonElement).click());
    await flush();
    const formFields = container.querySelector('[data-form-fields]') as HTMLElement;
    expect(formFields.style.display).not.toBe('none');
    // Submit button is back in the DOM and clickable.
    expect(container.querySelector('button.submit')).toBeTruthy();
  });

  it('enabled: form fields render on the Local pane (regression guard)', async () => {
    createPicker({ allowLocalRepos: true });
    await open();
    act(() => (container.querySelector('[data-tab="local"]') as HTMLButtonElement).click());
    await flush();
    const formFields = container.querySelector('[data-form-fields]') as HTMLElement;
    expect(formFields.style.display).not.toBe('none');
  });
});

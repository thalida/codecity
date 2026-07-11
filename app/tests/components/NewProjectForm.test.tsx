// Native-harness tests for NewProjectForm — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { NewProjectForm } from '@/components/NewProjectForm/NewProjectForm';
import * as branchesApi from '@/api/branches';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { flush, drainAsync } from '../_helpers/preact';

function setInput(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function activeSegment(container: HTMLElement): string | undefined {
  return container.querySelector('.pane-tab--active')?.textContent ?? undefined;
}

describe('NewProjectForm', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    SCAN_PROGRESS.value = null;
    vi.restoreAllMocks();
  });

  it('auto-selects Git for a URL and Local for a bare path, but a manual click still overrides it', async () => {
    render(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, container);
    await flush();
    expect(activeSegment(container)).toBe('Git URL');

    const urlInput = container.querySelector<HTMLInputElement>('input[aria-label="URL"]')!;
    setInput(urlInput, '/Users/thalida/repo');
    await flush();
    expect(activeSegment(container)).toBe('Local path');

    const pathInput = container.querySelector<HTMLInputElement>('input[aria-label="Path"]')!;
    setInput(pathInput, 'https://github.com/o/r');
    await flush();
    expect(activeSegment(container)).toBe('Git URL');

    // Manual override: force Local even though the typed text still looks remote.
    const localTab = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Local path'
    )!;
    localTab.click();
    await flush();
    expect(activeSegment(container)).toBe('Local path');
  });

  it('resets the branch when the URL changes to a different repo (bug #2)', async () => {
    const resolve = vi.spyOn(branchesApi, 'fetchBranches');
    resolve.mockResolvedValueOnce({ branches: ['main', 'feat'], default: 'main' });
    const onSubmit = vi.fn();

    render(<NewProjectForm allowLocalRepos onSubmit={onSubmit} />, container);
    await flush();

    const urlInput = container.querySelector<HTMLInputElement>('input[aria-label="URL"]')!;
    setInput(urlInput, 'https://github.com/o/first');
    await drainAsync();

    // User picks the non-default branch on the first repo.
    const select = container.querySelector<HTMLSelectElement>('select')!;
    select.value = 'feat';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(select.value).toBe('feat');

    // Now point the field at a different repo entirely. This repo has no
    // detectable default (default: null), so nothing auto-preselects a
    // branch for it — if the stale 'feat' pick isn't explicitly cleared,
    // it's the only branch value left standing and rides along unnoticed.
    resolve.mockResolvedValueOnce({ branches: ['main'], default: null });
    setInput(urlInput, 'https://github.com/o/second');
    await drainAsync();

    const submitBtn = container.querySelector<HTMLButtonElement>('[aria-label="Open project"]')!;
    submitBtn.click();
    await flush();

    const payload = onSubmit.mock.calls.at(-1)?.[0];
    expect(payload.src).toBe('https://github.com/o/second');
    // The load-bearing assertion: 'feat' (the FIRST repo's pick) must never
    // ride along to the second repo's submit.
    expect(payload.branch).not.toBe('feat');
    expect(payload.branch).toBeUndefined();
  });

  it('blocks submit and shows one inline field error when branch resolution fails (repo not found)', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new Error('repository not found at https://github.com/o/nope')
    );
    const onSubmit = vi.fn();

    render(<NewProjectForm allowLocalRepos onSubmit={onSubmit} />, container);
    await flush();

    const urlInput = container.querySelector<HTMLInputElement>('input[aria-label="URL"]')!;
    setInput(urlInput, 'https://github.com/o/nope');
    await drainAsync();

    // The lookup failure is surfaced as the URL field error (same treatment as
    // client validation), and Open is disabled — no doomed submit into a
    // different, jarring error state.
    expect(container.querySelector('.new-project-error')?.textContent).toMatch(
      /repository not found/i
    );
    const submitBtn = container.querySelector<HTMLButtonElement>('[aria-label="Open project"]')!;
    expect(submitBtn.disabled).toBe(true);

    submitBtn.click();
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a web-page URL (with a #anchor) inline, blocking submit and the branch lookup', async () => {
    const resolve = vi
      .spyOn(branchesApi, 'fetchBranches')
      .mockResolvedValue({ branches: [], default: null });
    render(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, container);
    await flush();

    const urlInput = container.querySelector<HTMLInputElement>('input[aria-label="URL"]')!;
    setInput(urlInput, 'https://github.com/thalida/codecity#local-directories');
    await drainAsync();

    // One standard inline form error (not a raw branch/clone failure).
    expect(container.querySelector('.new-project-error')?.textContent).toMatch(/# or \?/);
    // Submit disabled, no branch lookup fired, and no Branch dropdown for a bad URL.
    const submitBtn = container.querySelector<HTMLButtonElement>('[aria-label="Open project"]')!;
    expect(submitBtn.disabled).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(container.querySelector('select')).toBeNull();
  });

  it('demotes skip-cache to an off-by-default Advanced disclosure', async () => {
    render(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, container);
    await flush();

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>('.new-project-advanced-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await flush();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
  });

  it('shows a concise disabled-local note and blocks submit when local repos are off', async () => {
    render(<NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />, container);
    await flush();

    const localTab = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Local path'
    )!;
    localTab.click();
    await flush();

    expect(container.textContent).toMatch(/local repos are off/i);
    // Concise, not a wall: no leftover path input competing with the note.
    expect(container.querySelector('input[aria-label="Path"]')).toBeNull();

    // Nothing is submittable in this state, so the submit button and the
    // Advanced disclosure are hidden entirely (not just disabled).
    expect(container.querySelector('[aria-label="Open project"]')).toBeNull();
    expect(container.querySelector('.new-project-advanced-toggle')).toBeNull();
  });

  it('never uses an em-dash in the disabled-local copy', async () => {
    render(<NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />, container);
    await flush();
    const localTab = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Local path'
    )!;
    localTab.click();
    await flush();

    expect(container.querySelector('.new-project-note')?.textContent).not.toMatch(/—/);
  });

  it('keeps the URL field mounted while typing a git URL char-by-char when local repos are off', async () => {
    // Regression guard: srcKind() classifies any string without "://" or a
    // user@host: prefix as Local, so the very first keystroke of a URL ("h")
    // used to flip kind→Local. With local repos off that made localOff true,
    // which unmounted the shared source input mid-keystroke and dropped focus.
    // With local disabled, Local isn't a reachable destination, so kind must
    // pin to Git and the field must never disappear while the user types.
    render(<NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />, container);
    await flush();

    const urlInput = container.querySelector<HTMLInputElement>('input[aria-label="URL"]')!;
    expect(urlInput).not.toBeNull();

    for (const chunk of ['h', 'ht', 'htt', 'http']) {
      setInput(urlInput, chunk);
      await flush();
      // The input the user is typing into must stay in the DOM at every step.
      expect(container.querySelector('input[aria-label="URL"]')).not.toBeNull();
      // ...and kind stays Git, never flipping to the unreachable Local.
      expect(activeSegment(container)).toBe('Git URL');
    }
  });
});

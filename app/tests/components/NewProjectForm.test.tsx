// Native-harness tests for NewProjectForm — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { NewProjectForm } from '@/components/sources/NewProjectForm/NewProjectForm';
import * as branchesApi from '@/api/branches';
import { ScanError } from '@/api/manifest';
import { SCAN_PROGRESS } from '@/state/stores/progress';
import { flush, drainAsync, drainDebounced } from '../_helpers/preact';
import { BRANCH_LOOKUP_DEBOUNCE_MS } from '@/components/sources/NewProjectForm/NewProjectForm';

// Label-independent: the source field's label switches on allowLocalRepos.
const FIELD = 'input.form-input';

function setInput(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function field(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(FIELD)!;
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

  it('is one field (no tabs): a URL gets a branch dropdown, a local path does not', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockResolvedValue({
      branches: ['main', 'dev'],
      default: 'main',
    });
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    // No Repo URL / Local Path tabs — a single unified field.
    expect(container.querySelectorAll('.pane-tab').length).toBe(0);

    setInput(field(container), 'https://github.com/o/r');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);
    expect(container.querySelector('select')).not.toBeNull(); // URL → branch dropdown

    setInput(field(container), '/Users/thalida/repo');
    await flush();
    expect(container.querySelector('select')).toBeNull(); // local path → no branch dropdown
  });

  it('resolves branches once for a typed URL, not once per keystroke', async () => {
    // "https://github.com/o" already validates, so every character after it is
    // another resolvable URL: undebounced, the tail of a repo name is one git
    // ls-remote at the remote per keystroke. Typed at a cadence that lets
    // Preact run its effects between characters, as a real one would.
    const resolve = vi
      .spyOn(branchesApi, 'fetchBranches')
      .mockResolvedValue({ branches: ['main'], default: 'main' });
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();

    const url = 'https://github.com/o/repo';
    const typedFrom = url.length - 6;
    setInput(field(container), url.slice(0, typedFrom));
    await flush();
    for (let i = typedFrom + 1; i <= url.length; i++) {
      setInput(field(container), url.slice(0, i));
      await drainAsync(1, 20);
    }
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(url);
  });

  it('resets the branch when the URL changes to a different repo (bug #2)', async () => {
    const resolve = vi.spyOn(branchesApi, 'fetchBranches');
    resolve.mockResolvedValueOnce({ branches: ['main', 'feat'], default: 'main' });
    const onSubmit = vi.fn();

    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={onSubmit} />, container);
    await flush();

    setInput(field(container), 'https://github.com/o/first');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    // User picks the non-default branch on the first repo.
    const select = container.querySelector<HTMLSelectElement>('select')!;
    select.value = 'feat';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(select.value).toBe('feat');

    // This repo has no detectable default, so nothing preselects a branch: an
    // uncleared 'feat' would ride along unnoticed.
    resolve.mockResolvedValueOnce({ branches: ['main'], default: null });
    setInput(field(container), 'https://github.com/o/second');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    const submitBtn = container.querySelector<HTMLButtonElement>('.split-button-primary')!;
    submitBtn.click();
    await flush();

    const payload = onSubmit.mock.calls.at(-1)?.[0];
    expect(payload.src).toBe('https://github.com/o/second');
    expect(payload.branch).not.toBe('feat');
    expect(payload.branch).toBeUndefined();
  });

  it('blocks submit and shows one inline field error when branch resolution fails (repo not found)', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new Error('repository not found at https://github.com/o/nope')
    );
    const onSubmit = vi.fn();

    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={onSubmit} />, container);
    await flush();

    setInput(field(container), 'https://github.com/o/nope');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    expect(container.querySelector('.new-project-error')?.textContent).toMatch(
      /repository not found/i
    );
    const submitBtn = container.querySelector<HTMLButtonElement>('.split-button-primary')!;
    expect(submitBtn.disabled).toBe(true);

    submitBtn.click();
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a web-page URL (with a #anchor) inline, blocking submit and the branch lookup', async () => {
    const resolve = vi
      .spyOn(branchesApi, 'fetchBranches')
      .mockResolvedValue({ branches: [], default: null });
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();

    setInput(field(container), 'https://github.com/thalida/codecity#local-directories');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    expect(container.querySelector('.new-project-error')?.textContent).toMatch(/# or \?/);
    const submitBtn = container.querySelector<HTMLButtonElement>('.split-button-primary')!;
    expect(submitBtn.disabled).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(container.querySelector('select')).toBeNull();
  });

  it('opens without skipCache by default', async () => {
    const onSubmit = vi.fn();
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={onSubmit} />, container);
    await flush();
    setInput(field(container), '/Users/thalida/repo');
    await flush();
    container.querySelector<HTMLButtonElement>('.split-button-primary')!.click();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith({ src: '/Users/thalida/repo', skipCache: undefined });
  });

  it('the fresh-scan menu item opens with skipCache', async () => {
    const onSubmit = vi.fn();
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={onSubmit} />, container);
    await flush();
    setInput(field(container), '/Users/thalida/repo');
    await flush();
    container.querySelector<HTMLButtonElement>('.split-button-caret')!.click();
    await flush();
    const item = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent?.includes('fresh scan')
    )!;
    expect(item).not.toBeUndefined();
    item.click();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith({ src: '/Users/thalida/repo', skipCache: true });
  });

  it('the fresh-scan item never submits the form itself', async () => {
    // It lives inside the real <form>, so a stray type="submit" would fire an
    // extra plain open alongside the fresh one.
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    container.querySelector<HTMLButtonElement>('.split-button-caret')!.click();
    await flush();
    for (const el of container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) {
      expect(el.type).toBe('button');
    }
  });

  it('drops the Advanced disclosure and its checkbox', async () => {
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    expect(container.querySelector('.new-project-advanced-toggle')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('shows exactly one notice for one failure, under the field', async () => {
    // Regression: the remedy rendered above the field while the raw server
    // message stayed below it, so a single failure spoke twice.
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new ScanError('repository not found at https://github.com/o/private', 'repo-not-found')
    );
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    expect(container.querySelectorAll('.unreachable')).toHaveLength(1);
    // The remedy replaces the raw message rather than joining it.
    expect(container.querySelector('.new-project-error')).toBeNull();
    // And it describes the field it belongs to.
    const notice = container.querySelector('.unreachable--error')!;
    expect(field(container).getAttribute('aria-describedby')).toBe(notice.id);
    expect(container.querySelector('.new-project-field')!.contains(notice)).toBe(true);
  });

  it('offers the remedy when the branch lookup says the repo is unreachable', async () => {
    // A private repo URL failed at the branch lookup and showed raw git stderr,
    // because the code was only threaded through the manifest stream.
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new ScanError('repository not found at https://github.com/o/private', 'repo-not-found')
    );
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);

    const notice = container.querySelector('.unreachable--error');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Couldn't reach that repo.");
  });

  it('drops the remedy the moment the URL is edited, before the new lookup lands', async () => {
    // Holding the next lookup open is what pins "straight away": a mock that
    // rejects every URL makes this pass only by winning a race.
    let arriveAtOther = () => {};
    const other = new Promise<branchesApi.BranchList>((resolve) => {
      arriveAtOther = () => resolve({ branches: ['main'], default: 'main' });
    });
    vi.spyOn(branchesApi, 'fetchBranches').mockImplementation((url: string) =>
      url.includes('/private') ? Promise.reject(new ScanError('nope', 'repo-not-found')) : other
    );
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);
    expect(container.querySelector('.unreachable--error')).not.toBeNull();

    setInput(field(container), 'https://github.com/o/other');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);
    expect(container.querySelector('.unreachable--error')).toBeNull();

    arriveAtOther();
    await drainAsync();
    expect(container.querySelector('.unreachable--error')).toBeNull();
  });

  it('drops the remedy when the field turns into a local path', async () => {
    // The only route with nothing else to clear it: a path unmounts BranchSelect,
    // so its remount is not there to report the error away.
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new ScanError('nope', 'repo-not-found')
    );
    render(<NewProjectForm allowLocalRepos hosted={false} onSubmit={() => {}} />, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);
    expect(container.querySelector('.unreachable--error')).not.toBeNull();

    setInput(field(container), '/Users/me/code/proj');
    await drainAsync();
    expect(container.querySelector('.unreachable--error')).toBeNull();
  });

  it('answers a remote not-found with the error remedy, keyed on the code', async () => {
    render(
      <NewProjectForm
        allowLocalRepos
        hosted={false}
        errorCode="repo-not-found"
        prefill={{ src: 'https://github.com/owner/repo' }}
        onSubmit={() => {}}
      />,
      container
    );
    await flush();
    const notice = container.querySelector('.unreachable--error');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Couldn't reach that repo.");
    // allowLocal, so this cell carries the clone command for the attempted src.
    expect(notice?.textContent).toContain('git clone https://github.com/owner/repo');
  });

  it('does not offer the not-found remedy for a failure without that code', async () => {
    // The message is the server's to reword, so nothing may key on its text.
    render(
      <NewProjectForm
        allowLocalRepos
        hosted={false}
        prefill={{ src: 'https://github.com/owner/repo' }}
        onSubmit={() => {}}
      />,
      container
    );
    await flush();
    expect(container.querySelector('.unreachable--error')).toBeNull();
  });

  it('when local repos are off: URL-only label + a standing "how to enable" notice, and a path blocks submit', async () => {
    render(
      <NewProjectForm allowLocalRepos={false} hosted={false} onSubmit={() => {}} />,
      container
    );
    await flush();

    // Label reflects the URL-only mode.
    expect(container.querySelector('label')?.textContent).toBe('Repo URL');
    // The notice stands on its own (before any input), with the how-to link.
    const note = container.querySelector('.unreachable--standing');
    expect(note?.textContent).toMatch(/turn on local paths to open a folder/i);
    expect(note?.querySelector('a')?.getAttribute('href')).toMatch(/local-directories/);

    // Typing a clear path blocks submit (the button stays present, just disabled).
    setInput(field(container), '/Users/thalida/repo');
    await flush();
    const submitBtn = container.querySelector<HTMLButtonElement>('.split-button-primary')!;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);
  });

  // A blocked path left the notice standing under an already-red field with
  // aria-describedby unset, so the invalid field pointed at nothing.
  it('turns the notice into an error once a blocked path is typed', async () => {
    render(
      <NewProjectForm allowLocalRepos={false} hosted={false} onSubmit={() => {}} />,
      container
    );
    await flush();
    expect(container.querySelector('.unreachable--standing')).not.toBeNull();

    setInput(field(container), '/Users/thalida/repo');
    await flush();

    const note = container.querySelector('.unreachable--error');
    expect(note).not.toBeNull();
    expect(container.querySelector('.unreachable--standing')).toBeNull();
    expect(note?.textContent).toMatch(/local paths are turned off/i);
    // Cloning is not the answer to a repo already on this machine.
    expect(note?.textContent).not.toMatch(/clone it yourself/i);

    // The invalid field points at the message describing it.
    const input = field(container);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(note?.id);
  });

  // A failed open used to also render a banner above the card, so one failure
  // spoke twice and the field it described was never marked invalid.
  it('puts the message from a failed open in the field slot, not above it', async () => {
    render(
      <NewProjectForm
        allowLocalRepos
        hosted={false}
        error="path not found"
        prefill={{ src: '/Users/thalida/nope' }}
        onSubmit={() => {}}
      />,
      container
    );
    await flush();

    const note = container.querySelector('.new-project-error');
    expect(note?.textContent).toBe('path not found');
    // Inside the field's own block, after the input.
    expect(container.querySelector('.new-project-field')?.contains(note!)).toBe(true);

    const input = field(container);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(note?.id);
  });

  it('answers a coded failure with the remedy, never the raw message too', async () => {
    render(
      <NewProjectForm
        allowLocalRepos
        hosted={false}
        error="repository not found at https://github.com/o/private"
        errorCode="repo-not-found"
        prefill={{ src: 'https://github.com/o/private' }}
        onSubmit={() => {}}
      />,
      container
    );
    await flush();

    expect(container.querySelector('.unreachable--error')).not.toBeNull();
    expect(container.querySelector('.new-project-error')).toBeNull();
    expect(container.textContent).not.toContain('repository not found at');
  });

  it('hides the local notice once the input reads as a URL', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockResolvedValue({
      branches: ['main'],
      default: 'main',
    });
    render(
      <NewProjectForm allowLocalRepos={false} hosted={false} onSubmit={() => {}} />,
      container
    );
    await flush();
    expect(container.querySelector('.unreachable--standing')).not.toBeNull(); // standing while empty

    setInput(field(container), 'https://github.com/o/r');
    await drainDebounced(BRANCH_LOOKUP_DEBOUNCE_MS);
    expect(container.querySelector('.unreachable--standing')).toBeNull(); // gone for a URL
  });

  it('never uses an em-dash in the disabled-local notice copy', async () => {
    render(
      <NewProjectForm allowLocalRepos={false} hosted={false} onSubmit={() => {}} />,
      container
    );
    await flush();
    expect(container.querySelector('.unreachable')?.textContent).not.toMatch(/—/);
  });

  it('keeps the field mounted (and shows no path error) while typing a git URL char-by-char when local repos are off', async () => {
    // srcKind() reads anything without "://" as Local, so a URL's first
    // keystrokes look like a path: the field must not unmount or flash.
    render(
      <NewProjectForm allowLocalRepos={false} hosted={false} onSubmit={() => {}} />,
      container
    );
    await flush();
    expect(container.querySelector(FIELD)).not.toBeNull();

    for (const chunk of ['h', 'ht', 'htt', 'http']) {
      setInput(field(container), chunk);
      await flush();
      expect(container.querySelector(FIELD)).not.toBeNull();
      expect(container.querySelector('.new-project-error')?.textContent ?? '').not.toMatch(
        /local paths/i
      );
    }
  });
});

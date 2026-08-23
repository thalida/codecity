// Native-harness tests for NewProjectForm — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { NewProjectForm } from '@/components/sources/NewProjectForm/NewProjectForm';
import * as branchesApi from '@/api/branches';
import { ScanError } from '@/city/session/api/manifest';
import { flush, drainAsync } from '../_helpers/preact';
import { BRANCH_LOOKUP_DEBOUNCE_MS } from '@/components/sources/NewProjectForm/NewProjectForm';
import { makeSession, renderInCity } from '../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

// Label-independent: the source field's label switches on allowLocalRepos.
const FIELD = 'input.form-input';

function setInput(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function field(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(FIELD)!;
}

/** Past the form's branch-lookup debounce, then the usual async settle. Waits
 *  on the component's own interval, so it can't drift from a literal here. */
async function drainDebounced(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, BRANCH_LOOKUP_DEBOUNCE_MS + 20));
  await drainAsync();
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
    session.progress.scan.value = null;
    vi.restoreAllMocks();
  });

  it('is one field (no tabs): a URL gets a branch dropdown, a local path does not', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockResolvedValue({
      branches: ['main', 'dev'],
      default: 'main',
    });
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();
    // No Repo URL / Local Path tabs — a single unified field.
    expect(container.querySelectorAll('.pane-tab').length).toBe(0);

    setInput(field(container), 'https://github.com/o/r');
    await drainDebounced();
    expect(container.querySelector('select')).not.toBeNull(); // URL → branch dropdown

    setInput(field(container), '/Users/thalida/repo');
    await flush();
    expect(container.querySelector('select')).toBeNull(); // local path → no branch dropdown
  });

  it('resolves branches once for a typed URL, not once per keystroke', async () => {
    // "https://github.com/o" already validates, so undebounced every character
    // after it is another git ls-remote. Typed at a real keystroke cadence.
    const resolve = vi
      .spyOn(branchesApi, 'fetchBranches')
      .mockResolvedValue({ branches: ['main'], default: 'main' });
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();

    const url = 'https://github.com/o/repo';
    const typedFrom = url.length - 6;
    setInput(field(container), url.slice(0, typedFrom));
    await flush();
    for (let i = typedFrom + 1; i <= url.length; i++) {
      setInput(field(container), url.slice(0, i));
      await drainAsync(1, 20);
    }
    await drainDebounced();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(url);
  });

  it('resets the branch when the URL changes to a different repo (bug #2)', async () => {
    const resolve = vi.spyOn(branchesApi, 'fetchBranches');
    resolve.mockResolvedValueOnce({ branches: ['main', 'feat'], default: 'main' });
    const onSubmit = vi.fn();

    renderInCity(<NewProjectForm allowLocalRepos onSubmit={onSubmit} />, session, container);
    await flush();

    setInput(field(container), 'https://github.com/o/first');
    await drainDebounced();

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
    await drainDebounced();

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

    renderInCity(<NewProjectForm allowLocalRepos onSubmit={onSubmit} />, session, container);
    await flush();

    setInput(field(container), 'https://github.com/o/nope');
    await drainDebounced();

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
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();

    setInput(field(container), 'https://github.com/thalida/codecity#local-directories');
    await drainDebounced();

    expect(container.querySelector('.new-project-error')?.textContent).toMatch(/# or \?/);
    const submitBtn = container.querySelector<HTMLButtonElement>('.split-button-primary')!;
    expect(submitBtn.disabled).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(container.querySelector('select')).toBeNull();
  });

  it('opens without skipCache by default', async () => {
    const onSubmit = vi.fn();
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={onSubmit} />, session, container);
    await flush();
    setInput(field(container), '/Users/thalida/repo');
    await flush();
    container.querySelector<HTMLButtonElement>('.split-button-primary')!.click();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith({ src: '/Users/thalida/repo', skipCache: undefined });
  });

  it('the fresh-scan menu item opens with skipCache', async () => {
    const onSubmit = vi.fn();
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={onSubmit} />, session, container);
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
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();
    container.querySelector<HTMLButtonElement>('.split-button-caret')!.click();
    await flush();
    for (const el of container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) {
      expect(el.type).toBe('button');
    }
  });

  it('drops the Advanced disclosure and its checkbox', async () => {
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
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
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced();

    expect(container.querySelectorAll('.unreachable')).toHaveLength(1);
    // The remedy replaces the raw message rather than joining it.
    expect(container.querySelector('.new-project-error')).toBeNull();
    // And it describes the field it belongs to.
    const notice = container.querySelector('.unreachable')!;
    expect(field(container).getAttribute('aria-describedby')).toBe(notice.id);
    expect(container.querySelector('.new-project-field')!.contains(notice)).toBe(true);
  });

  it('offers the remedy when the branch lookup says the repo is unreachable', async () => {
    // A private repo URL failed at the branch lookup and showed raw git stderr,
    // because the code was only threaded through the manifest stream.
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new ScanError('repository not found at https://github.com/o/private', 'repo-not-found')
    );
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced();

    const notice = container.querySelector('.unreachable');
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
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced();
    expect(container.querySelector('.unreachable')).not.toBeNull();

    setInput(field(container), 'https://github.com/o/other');
    await drainDebounced();
    expect(container.querySelector('.unreachable')).toBeNull();

    arriveAtOther();
    await drainAsync();
    expect(container.querySelector('.unreachable')).toBeNull();
  });

  it('drops the remedy when the field turns into a local path', async () => {
    // The only route with nothing else to clear it: a path unmounts BranchSelect,
    // so its remount is not there to report the error away.
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new ScanError('nope', 'repo-not-found')
    );
    renderInCity(<NewProjectForm allowLocalRepos onSubmit={() => {}} />, session, container);
    await flush();
    setInput(field(container), 'https://github.com/o/private');
    await drainDebounced();
    expect(container.querySelector('.unreachable')).not.toBeNull();

    setInput(field(container), '/Users/me/code/proj');
    await drainAsync();
    expect(container.querySelector('.unreachable')).toBeNull();
  });

  it('answers a remote not-found with the error remedy, keyed on the code', async () => {
    renderInCity(
      <NewProjectForm
        allowLocalRepos
        errorCode="repo-not-found"
        prefill={{ src: 'https://github.com/owner/repo' }}
        onSubmit={() => {}}
      />,
      session,
      container
    );
    await flush();
    const notice = container.querySelector('.unreachable');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Couldn't reach that repo.");
    // allowLocal, so this cell carries the clone command for the attempted src.
    expect(notice?.textContent).toContain('git clone https://github.com/owner/repo');
  });

  it('does not offer the not-found remedy for a failure without that code', async () => {
    // The message is the server's to reword, so nothing may key on its text.
    renderInCity(
      <NewProjectForm
        allowLocalRepos
        prefill={{ src: 'https://github.com/owner/repo' }}
        onSubmit={() => {}}
      />,
      session,
      container
    );
    await flush();
    expect(container.querySelector('.unreachable')).toBeNull();
  });

  it('when local repos are off: URL-only label, and a path blocks submit', async () => {
    renderInCity(
      <NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />,
      session,
      container
    );
    await flush();

    // Label reflects the URL-only mode.
    expect(container.querySelector('label')?.textContent).toBe('Repo URL');
    // Nothing resting: what this instance can open is the landing's to say, and
    // it says it in the hero where it does not move around.
    expect(container.querySelector('.unreachable')).toBeNull();

    // Typing a clear path blocks submit (the button stays present, just disabled).
    setInput(field(container), '/Users/thalida/repo');
    await flush();
    const submitBtn = container.querySelector<HTMLButtonElement>('.split-button-primary')!;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);
  });

  // A blocked path left the notice standing under an already-red field with
  // aria-describedby unset, so the invalid field pointed at nothing.
  it('answers a blocked path where the field is, with the command that fixes it', async () => {
    renderInCity(
      <NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />,
      session,
      container
    );
    await flush();

    setInput(field(container), '/Users/thalida/repo');
    await flush();

    const note = container.querySelector('.unreachable')!;
    expect(note).not.toBeNull();
    expect(note.getAttribute('role')).toBe('alert');
    expect(field(container).getAttribute('aria-describedby')).toBe(note.id);
    // No switch is claimed, because a mount is what actually turns this on.
    expect(note.textContent).not.toMatch(/turned off/i);
    expect(note.textContent).toMatch(/couldn't open that path/i);
    expect(note.textContent).toMatch(/run codecity with a volume mount/i);
    // Cloning is not the answer to a folder already on this machine.
    expect(note.textContent).not.toMatch(/clone/i);
    // The remedy is offered, not just described.
    expect(note.querySelector('.unreachable-disclose')).not.toBeNull();
  });

  it('says nothing at rest, whatever is being typed', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockResolvedValue({
      branches: ['main'],
      default: 'main',
    });
    renderInCity(
      <NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />,
      session,
      container
    );
    await flush();
    expect(container.querySelector('.unreachable')).toBeNull();

    setInput(field(container), 'https://github.com/o/r');
    await drainDebounced();
    expect(container.querySelector('.unreachable')).toBeNull();
  });

  // The whole slot, not just the notice: the validation strings share it.
  it('never uses an em-dash in anything the field slot says', async () => {
    renderInCity(
      <NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />,
      session,
      container
    );
    await flush();

    for (const typed of ['/Users/thalida/repo', 'not a url']) {
      setInput(field(container), typed);
      await flush();
      const slot = container.querySelector('.new-project-field')!;
      expect(slot.textContent).not.toMatch(/—/);
    }
  });

  it('keeps the field mounted (and shows no path error) while typing a git URL char-by-char when local repos are off', async () => {
    // srcKind() reads anything without "://" as Local, so a URL's first
    // keystrokes look like a path: the field must not unmount or flash.
    renderInCity(
      <NewProjectForm allowLocalRepos={false} onSubmit={() => {}} />,
      session,
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

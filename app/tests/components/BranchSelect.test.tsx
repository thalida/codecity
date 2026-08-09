// Native-harness tests for BranchSelect — mirrors app/tests/layout/leftSidebar.test.tsx's
// render/flush/container pattern (this repo has no @testing-library/preact dependency).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { BranchSelect } from '@/components/BranchSelect/BranchSelect';
import * as branchesApi from '@/api/branches';
import { ScanError } from '@/api/manifest';
import { flush, drainAsync } from '../_helpers/preact';

describe('BranchSelect', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('renders nothing while idle (no url)', async () => {
    render(<BranchSelect url="" value="" onChange={() => {}} onError={() => {}} />, container);
    await flush();
    expect(container.querySelector('.branch-select')).toBeNull();
  });

  it('shows a resolving state, then the dropdown with the repo default preselected and marked', async () => {
    // Manually-controlled promise (rather than mockResolvedValue) so the
    // loading assertion below can't race past the resolution on the
    // microtask queue — it only settles once resolveFetch is called.
    let resolveFetch!: (r: { branches: string[]; default: string | null }) => void;
    vi.spyOn(branchesApi, 'fetchBranches').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    const onChange = vi.fn();

    render(
      <BranchSelect url="https://github.com/o/r" value="" onChange={onChange} onError={() => {}} />,
      container
    );
    // The mocked fetch never settles until resolveFetch() runs below, so it's
    // safe to drain generously here — the component can only be idle or
    // loading, never past it (Preact's effect scheduling has a real-timer
    // hop, so a single microtask flush() is not enough to observe this).
    await drainAsync();
    expect(container.querySelector('.branch-select-status')?.textContent).toMatch(/resolving/i);

    resolveFetch({ branches: ['main', 'dev'], default: 'main' });
    await drainAsync();

    // The repo default is preselected via onChange (the parent owns `value`).
    expect(onChange).toHaveBeenCalledWith('main');
    const select = container.querySelector<HTMLSelectElement>('select')!;
    expect(select).not.toBeNull();
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toContain('main (default)');
    expect(optionTexts).toContain('dev');
  });

  it('passes the server code up, so the form can offer a remedy', async () => {
    // The branch lookup is the first request to touch the remote, so an
    // unreachable repo fails HERE rather than on submit.
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(
      new ScanError('repository not found at https://github.com/o/nope', 'repo-not-found')
    );
    const onError = vi.fn();
    render(
      <BranchSelect
        url="https://github.com/o/nope"
        value=""
        onChange={() => {}}
        onError={onError}
      />,
      container
    );
    await drainAsync();
    expect(onError).toHaveBeenCalledWith(
      'repository not found at https://github.com/o/nope',
      'repo-not-found'
    );
  });

  it('reports the server error to the parent (onError) and renders nothing itself', async () => {
    vi.spyOn(branchesApi, 'fetchBranches').mockRejectedValue(new Error('repository not found'));
    const onError = vi.fn();

    render(
      <BranchSelect
        url="https://github.com/o/nope"
        value=""
        onChange={() => {}}
        onError={onError}
      />,
      container
    );
    await drainAsync();

    // The error is surfaced to the parent (shown as the URL field error), not
    // rendered here; no dropdown, and BranchSelect adds nothing to the DOM.
    expect(onError).toHaveBeenCalledWith('repository not found', undefined);
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('.branch-select')).toBeNull();
  });

  it('re-resolves when the url prop changes (parent typically remounts via key instead)', async () => {
    const resolve = vi.spyOn(branchesApi, 'fetchBranches');
    resolve.mockResolvedValueOnce({ branches: ['main'], default: 'main' });
    const onChange = vi.fn();

    render(
      <BranchSelect
        url="https://github.com/o/first"
        value=""
        onChange={onChange}
        onError={() => {}}
      />,
      container
    );
    await drainAsync();
    expect(resolve).toHaveBeenCalledWith('https://github.com/o/first');

    resolve.mockResolvedValueOnce({ branches: ['trunk'], default: 'trunk' });
    render(
      <BranchSelect
        url="https://github.com/o/second"
        value=""
        onChange={onChange}
        onError={() => {}}
      />,
      container
    );
    await drainAsync();

    expect(resolve).toHaveBeenCalledWith('https://github.com/o/second');
    expect(onChange).toHaveBeenCalledWith('trunk');
  });
});

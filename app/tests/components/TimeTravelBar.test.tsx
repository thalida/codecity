// Mirrors BranchSelect.test.tsx's native render/flush/vi.spyOn harness.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';
import * as useManifestSourceModule from '@/hooks/useManifestSource';
import { MANIFEST } from '@/state/stores/manifest';
import { TIME_TRAVEL_REF } from '@/state/stores/timeTravel';
import { flush } from '../_helpers/preact';
import type { CommitEntry, Manifest } from '@/types';

const commit = (sha: string, date: string, subject: string): CommitEntry => ({
  sha,
  date,
  subject,
  files: 1,
  authors: ['Someone'],
  same_day_total: 1,
});

describe('TimeTravelBar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    MANIFEST.value = null;
    TIME_TRAVEL_REF.value = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('spans the full history and loads the settled commit after the debounce', async () => {
    const loadRefSpy = vi.spyOn(useManifestSourceModule, 'loadRef').mockResolvedValue(undefined);

    const old = commit('aaaaaaa1111111111111111111111111111111', '2026-01-01', 'oldest');
    const mid = commit('bbbbbbb2222222222222222222222222222222', '2026-02-01', 'middle');
    const head = commit('ccccccc3333333333333333333333333333333', '2026-03-01', 'head');
    MANIFEST.value = { tree: { name: 'r' }, commits: [old, mid, head] } as unknown as Manifest;
    await flush();

    render(<TimeTravelBar />, container);
    await flush();

    const input = container.querySelector<HTMLInputElement>('input[type=range]')!;
    expect(input).not.toBeNull();
    expect(input.max).toBe('2');

    vi.useFakeTimers();
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(loadRefSpy).not.toHaveBeenCalled(); // debounced, not immediate
    vi.advanceTimersByTime(150);
    expect(loadRefSpy).toHaveBeenCalledWith(old.sha);
  });
});

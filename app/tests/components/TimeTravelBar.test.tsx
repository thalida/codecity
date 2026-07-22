// Mirrors BranchSelect.test.tsx's native render/flush/vi.spyOn harness.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';
import * as useManifestSourceModule from '@/hooks/useManifestSource';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { flush } from '../_helpers/preact';
import type { CommitEntry, TimelineBundle } from '@/types';

const commit = (sha: string, date: string, subject: string): CommitEntry => ({
  sha,
  date,
  subject,
  files: 1,
  authors: ['Someone'],
  same_day_total: 1,
});

const old = commit('aaaaaaa1111111111111111111111111111111', '2026-01-01', 'oldest');
const mid = commit('bbbbbbb2222222222222222222222222222222', '2026-02-01', 'middle');
const head = commit('ccccccc3333333333333333333333333333333', '2026-03-01', 'head');

const BUNDLE = {
  commits: [old, mid, head],
  unionManifest: { tree: { name: 'r' }, repo: { remote_url: 'https://example.com/r' } },
  deltas: [],
  blobLines: {},
  note: null,
} as unknown as TimelineBundle;

describe('TimeTravelBar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    TIMELINE_MODE.value = false;
    SCRUB_POS.value = 0;
    TIMELINE_BUNDLE.value = null;
    vi.restoreAllMocks();
  });

  it('renders nothing when timeline mode is off', async () => {
    TIMELINE_MODE.value = false;
    TIMELINE_BUNDLE.value = BUNDLE;
    SCRUB_POS.value = 2;

    render(<TimeTravelBar />, container);
    await flush();

    expect(container.querySelector('.time-travel-bar')).toBeNull();
  });

  it('spans the full history and scrubs SCRUB_POS continuously with no debounce or loadRef call', async () => {
    const loadRefSpy = vi.spyOn(useManifestSourceModule, 'loadRef').mockResolvedValue(undefined);

    TIMELINE_MODE.value = true;
    TIMELINE_BUNDLE.value = BUNDLE;
    SCRUB_POS.value = 2;

    render(<TimeTravelBar />, container);
    await flush();

    const input = container.querySelector<HTMLInputElement>('input[type=range]')!;
    expect(input).not.toBeNull();
    expect(input.max).toBe('2');
    expect(input.value).toBe('2');

    const sha = container.querySelector('.time-travel-sha')!;
    expect(sha.textContent).toBe(head.sha.slice(0, 7));

    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(SCRUB_POS.value).toBe(0); // synchronous, no debounce
    expect(loadRefSpy).not.toHaveBeenCalled();
  });

  it('tracks SCRUB_POS updates from outside the component', async () => {
    TIMELINE_MODE.value = true;
    TIMELINE_BUNDLE.value = BUNDLE;
    SCRUB_POS.value = 0;

    render(<TimeTravelBar />, container);
    await flush();

    SCRUB_POS.value = 1;
    await flush();

    const input = container.querySelector<HTMLInputElement>('input[type=range]')!;
    expect(input.value).toBe('1');
    const sha = container.querySelector('.time-travel-sha')!;
    expect(sha.textContent).toBe(mid.sha.slice(0, 7));
  });
});

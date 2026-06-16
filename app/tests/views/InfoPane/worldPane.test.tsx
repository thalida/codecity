import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { flush } from '../../_helpers/preact';

const { selectPath, focusPath, selectCommit, focusCommit } = vi.hoisted(() => ({
  selectPath: vi.fn(),
  focusPath: vi.fn(),
  selectCommit: vi.fn(),
  focusCommit: vi.fn(),
}));
vi.mock('@/state/stores/scene', () => ({ selectPath, focusPath, selectCommit, focusCommit }));

import { WorldPane } from '@/views/InfoPane/WorldPane';
import { NodeKind } from '@/types';
import type { Manifest } from '@/types';

const tree = {
  name: 'repo', type: NodeKind.Directory, path: '', fullPath: '/repo',
  children: [
    { name: 'a.ts', type: NodeKind.File, path: 'a.ts', fullPath: '/repo/a.ts', extension: '.ts', size: 10, lines: 3, binary: false, created: '2020-01-01T00:00:00Z', modified: '2020-01-01T00:00:00Z' },
  ],
  children_count: 1, children_file_count: 1, children_dir_count: 0,
  descendants_count: 1, descendants_file_count: 1, descendants_dir_count: 0,
  descendants_size: 10, descendants_ext_breakdown: [{ ext: '.ts', count: 1, size: 10 }],
};
const manifest: Manifest = {
  root: '/repo', scanned_at: '2024-01-01T00:00:00Z', signature: 's', tree_signature: 't',
  tree: tree as unknown as Manifest['tree'],
  repo: { branch: 'main', remote_url: null, head_sha: null, head_subject: null, dirty: false },
  commits: [], busyness: { avg: 1, busy: 2 },
  dateRanges: { createdMin: '2020-01-01T00:00:00Z', createdMax: '2020-01-01T00:00:00Z', modifiedMin: '2020-01-01T00:00:00Z', modifiedMax: '2020-01-01T00:00:00Z' },
};

describe('WorldPane', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    selectPath.mockClear(); focusPath.mockClear(); selectCommit.mockClear(); focusCommit.mockClear();
  });
  afterEach(() => { render(null, container); container.remove(); });

  it('renders the empty state when there is no project', async () => {
    const sig = signal(null);
    render(<WorldPane manifest={sig as never} />, container);
    await flush();
    expect(container.textContent).toContain('No project loaded');
  });

  it('clicking a building landmark selects + focuses its file', async () => {
    const sig = signal(manifest);
    render(<WorldPane manifest={sig as never} />, container);
    await flush();
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Tallest building'),
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(selectPath).toHaveBeenCalledWith('a.ts');
    expect(focusPath).toHaveBeenCalledWith('a.ts');
  });
});

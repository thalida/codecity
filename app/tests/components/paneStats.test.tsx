import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { PaneStats } from '@/components/PaneStats/PaneStats';
import { fileStatItems, directoryStatItems } from '@/components/PaneStats/statItems';
import { NodeKind, type FileNode, type DirNode } from '@/types';
import { flush } from '../_helpers/preact';

const NOW = Date.UTC(2024, 2, 25);

const FILE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
  fullPath: '/tmp/project/src/index.ts',
  extension: '.ts',
  size: 1536,
  lines: 50,
  binary: false,
  dirty: false,
  created: '2024-01-10T09:00:00Z',
  modified: '2024-03-20T10:00:00Z',
};

const DIR: DirNode = {
  name: 'src',
  type: NodeKind.Directory,
  path: 'src',
  fullPath: '/tmp/project/src',
  children: [],
  children_count: 3,
  children_file_count: 3,
  children_dir_count: 1,
  descendants_count: 12,
  descendants_file_count: 9,
  descendants_dir_count: 1,
  descendants_size: 4096,
  descendants_created_min: '2024-01-01T00:00:00Z',
  descendants_modified_max: '2024-02-01T00:00:00Z',
  descendants_ext_breakdown: [{ ext: '.ts', count: 9, size: 4096 }],
};

describe('statItems', () => {
  it('describes a file by language, size, and age', () => {
    const texts = fileStatItems(FILE, NOW).map((i) => i.text);
    expect(texts).toContain('50 lines');
    expect(texts.some((t) => t.startsWith('modified '))).toBe(true);
    expect(texts.some((t) => t.startsWith('created '))).toBe(true);
  });

  it('carries the exact date as the tooltip behind a relative age', () => {
    const modified = fileStatItems(FILE, NOW).find((i) => i.text.startsWith('modified '))!;
    expect(modified.title).toBeTruthy();
    expect(modified.title).not.toBe(modified.text);
  });

  it('omits stats the node does not carry', () => {
    const bare: FileNode = { ...FILE, lines: null, size: null, created: null, modified: null };
    const texts = fileStatItems(bare, NOW).map((i) => i.text);
    expect(texts.some((t) => t.includes('lines'))).toBe(false);
    expect(texts.some((t) => t.startsWith('modified'))).toBe(false);
  });

  it('shows a directory total alongside its direct count when they differ', () => {
    const files = directoryStatItems(DIR).find((i) => i.text.includes('files'))!;
    expect(files.text).toBe('3 files (9 total)');
  });

  it('collapses a directory count to one number when they match', () => {
    const dirs = directoryStatItems(DIR).find((i) => i.text.includes('dirs'))!;
    expect(dirs.text).toBe('1 dirs');
  });
});

describe('PaneStats', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('separates items with a dot, one fewer than the items', async () => {
    render(<PaneStats items={[{ text: 'a' }, { text: 'b' }, { text: 'c' }]} />, container);
    await flush();

    expect(container.querySelectorAll('.pane-stats-item')).toHaveLength(3);
    expect(container.querySelectorAll('.pane-stats-sep')).toHaveLength(2);
  });

  it('renders nothing at all when there are no items', async () => {
    render(<PaneStats items={[]} />, container);
    await flush();

    expect(container.querySelector('.pane-stats')).toBeNull();
  });
});

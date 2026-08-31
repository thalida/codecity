import { DirNode, FileNode, NodeKind } from '@codecity/city';
import type { TimelineBundle } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { PaneStats } from '@/components/PaneStats/PaneStats';
import { fileStatItems, directoryStatItems } from '@/components/PaneStats/statItems';
import { flush } from '../_helpers/preact';
import { createTimelineState } from '@codecity/city';

const NOW = Date.UTC(2024, 2, 25);

const FILE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
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

// In Timeline a node carries max-over-history values, so what the row must
// show is the replayed count for the commit under the scrubber. The tooltip
// and the pane both read it through here, which is what keeps them agreeing.
describe('statItems in Timeline', () => {
  const PATH = 'src/index.ts';
  let timeline: ReturnType<typeof createTimelineState>;

  /** What the row shows for FILE at wherever the scrubber is. Passed in, not
   *  looked up: which city is being described is the caller's to know. */
  const texts = () =>
    fileStatItems(FILE, { now: NOW, scrubbed: timeline.scrubbedStatsFor(PATH) }).map((i) => i.text);

  beforeEach(() => {
    timeline = createTimelineState();
    timeline.setBundle({
      commits: [
        { sha: 'a', date: '2024-01-01T00:00:00Z' },
        { sha: 'b', date: '2024-01-02T00:00:00Z' },
      ],
      deltas: [
        { sha: 'a', changes: [{ path: PATH, sha: 's1' }] },
        { sha: 'b', changes: [{ path: PATH, sha: 's2' }] },
      ],
      blobLines: { s1: 7, s2: 42 },
      blobSizes: { s1: 100, s2: 900 },
      notes: [],
    } as unknown as TimelineBundle);
    timeline.enter();
    timeline.setPosition(0);
  });

  it('shows the count at the scrubbed commit, not the union maximum', () => {
    // The static node carries 50, the union max across every commit.
    expect(texts()).toContain('7 lines');
  });

  it('follows the scrubber forward', () => {
    timeline.setPosition(1);
    expect(texts()).toContain('42 lines');
  });

  it('falls back to the node itself outside Timeline', () => {
    timeline.exit();
    expect(texts()).toContain('50 lines');
  });
});

describe('statItems', () => {
  it('describes a file by language, size, and age', () => {
    const texts = fileStatItems(FILE, { now: NOW }).map((i) => i.text);
    expect(texts).toContain('50 lines');
    expect(texts.some((t) => t.startsWith('modified '))).toBe(true);
    expect(texts.some((t) => t.startsWith('created '))).toBe(true);
  });

  it('carries the exact date as the tooltip behind a relative age', () => {
    const modified = fileStatItems(FILE, { now: NOW }).find((i) => i.text.startsWith('modified '))!;
    expect(modified.title).toBeTruthy();
    expect(modified.title).not.toBe(modified.text);
  });

  it('drops the dates when the caller asks for the short form', () => {
    const texts = fileStatItems(FILE, { now: NOW, dates: false }).map((i) => i.text);
    expect(texts).toContain('50 lines');
    expect(texts.some((t) => t.startsWith('modified'))).toBe(false);
    expect(texts.some((t) => t.startsWith('created'))).toBe(false);
  });

  it('reports pixel dimensions for media instead of a meaningless line count', () => {
    const png: FileNode = {
      ...FILE,
      name: 'logo.png',
      extension: '.png',
      binary: true,
      lines: 0,
      media_width: 800,
      media_height: 600,
    };
    const texts = fileStatItems(png, { now: NOW }).map((i) => i.text);
    expect(texts).toContain('800×600');
    expect(texts.some((t) => t.includes('lines'))).toBe(false);
  });

  it('omits stats the node does not carry', () => {
    const bare: FileNode = { ...FILE, lines: null, size: null, created: '', modified: '' };
    const texts = fileStatItems(bare, { now: NOW }).map((i) => i.text);
    expect(texts.some((t) => t.includes('lines'))).toBe(false);
    expect(texts.some((t) => t.startsWith('modified'))).toBe(false);
  });

  it('says a size is unknown rather than leaving the row silent', () => {
    // A blob the timeline backfill skipped has no measurable size. Showing
    // nothing reads as a short row; showing 0 B reads as an empty file.
    const unmeasured: FileNode = { ...FILE, size: null };
    const texts = fileStatItems(unmeasured, { now: NOW }).map((i) => i.text);
    expect(texts).toContain('size unknown');
    expect(texts.some((t) => t.includes('B'))).toBe(false);
  });

  it('names the kind before the counts that depend on it', () => {
    expect(directoryStatItems(DIR)[0].text).toBe('directory');
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

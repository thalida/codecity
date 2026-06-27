import { describe, it, expect } from 'vitest';
import { extBarPct, streetSummary } from '@/views/StreetPane/streetStats';
import { NodeKind } from '@/types';
import type { DirNode, ExtBreakdownEntry } from '@/types';

function dir(over: Partial<DirNode>): DirNode {
  return {
    name: 'src',
    type: NodeKind.Directory,
    path: 'src',
    fullPath: '/tmp/src',
    children: [],
    children_count: 0,
    children_file_count: 0,
    children_dir_count: 0,
    descendants_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
    descendants_ext_breakdown: [],
    ...over,
  } as DirNode;
}

function ext(e: string, count: number, size = 0): ExtBreakdownEntry {
  return { ext: e, count, size };
}

describe('extBarPct', () => {
  it('is 100 when count equals max', () => {
    expect(extBarPct(98, 98)).toBe(100);
  });
  it('scales linearly between 0 and max', () => {
    expect(extBarPct(49, 98)).toBe(50);
  });
  it('floors a tiny share to a visible sliver (4%)', () => {
    expect(extBarPct(1, 1000)).toBe(4);
  });
  it('is 0 when max is non-positive', () => {
    expect(extBarPct(5, 0)).toBe(0);
    expect(extBarPct(0, 0)).toBe(0);
  });
});

describe('streetSummary', () => {
  it('totals descendant files + size and names the dominant language', () => {
    const s = streetSummary(
      dir({
        descendants_file_count: 214,
        descendants_size: 1_300_000,
        descendants_ext_breakdown: [ext('.tsx', 98), ext('.ts', 64)],
      })
    );
    expect(s.totals).toContain('214 files');
    expect(s.totals).toContain('1.2 MB');
    expect(s.language).toBe('TypeScript');
  });
  it('drops the language clause for the (none) sentinel', () => {
    const s = streetSummary(
      dir({ descendants_file_count: 3, descendants_ext_breakdown: [ext('(none)', 3)] })
    );
    expect(s.language).toBeNull();
  });
  it('falls back to the uppercased extension for an unknown type', () => {
    const s = streetSummary(
      dir({ descendants_file_count: 2, descendants_ext_breakdown: [ext('.sketch', 2)] })
    );
    expect(s.language).toBe('SKETCH');
  });
  it('handles a directory with no files', () => {
    const s = streetSummary(dir({ descendants_file_count: 0 }));
    expect(s.totals).toContain('0 files');
    expect(s.language).toBeNull();
  });
});

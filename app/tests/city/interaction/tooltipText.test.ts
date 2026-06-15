import { describe, it, expect } from 'vitest';
import { formatHoverTooltip } from '@/city/interaction/tooltipText';
import { NodeKind } from '@/types';
import type { FileNode, DirNode } from '@/types';
import type { PickTarget } from '@/types';

// Minimal FileNode/DirNode factories — the formatter only reads a handful of
// fields, but the types require the full shape, so fill the rest with inert
// defaults.
function file(partial: Partial<FileNode>): FileNode {
  return {
    name: 'x',
    type: NodeKind.File,
    path: 'x',
    fullPath: '/x',
    extension: '',
    size: 0,
    lines: 0,
    binary: false,
    created: '',
    modified: '',
    ...partial,
  } as FileNode;
}

function fileTarget(partial: Partial<FileNode>): PickTarget {
  return { kind: NodeKind.File, file: file(partial) } as PickTarget;
}

function dirTarget(partial: Partial<DirNode>): PickTarget {
  return {
    kind: NodeKind.Directory,
    dir: { type: NodeKind.Directory, ...partial } as DirNode,
  } as PickTarget;
}

describe('formatHoverTooltip', () => {
  it('returns null for no target', () => {
    expect(formatHoverTooltip(null, 'codecity')).toBeNull();
  });

  it('shows line count for a plain text file', () => {
    const t = fileTarget({ path: 'app/main.ts', lines: 42 });
    expect(formatHoverTooltip(t, 'codecity')).toBe('/codecity/app/main.ts  ·  42 lines');
  });

  it('shows pixel dimensions instead of line count for an image file', () => {
    const t = fileTarget({
      path: 'app/logo.png',
      lines: 0,
      mediaKind: 'image',
      media_width: 1920,
      media_height: 1080,
    });
    expect(formatHoverTooltip(t, 'codecity')).toBe('/codecity/app/logo.png  ·  1920×1080');
  });

  it('falls back to line count when a media file has no dimensions', () => {
    const t = fileTarget({ path: 'app/clip.mp4', lines: 0, mediaKind: 'video' });
    expect(formatHoverTooltip(t, 'codecity')).toBe('/codecity/app/clip.mp4  ·  0 lines');
  });

  it('omits the suffix when a file has no line count', () => {
    const t = fileTarget({ path: 'app/empty', lines: null as unknown as number });
    expect(formatHoverTooltip(t, 'codecity')).toBe('/codecity/app/empty');
  });

  it('shows immediate child counts for a directory', () => {
    const t = dirTarget({ path: 'app', children_file_count: 3, children_dir_count: 1 });
    expect(formatHoverTooltip(t, 'codecity')).toBe('/codecity/app  ·  3 files, 1 dir');
  });

  it('prepends the root name as an absolute-looking path', () => {
    const t = fileTarget({ path: 'a.ts', lines: 1 });
    expect(formatHoverTooltip(t, 'myrepo')).toBe('/myrepo/a.ts  ·  1 lines');
  });

  it('drops the root segment when there is no root name', () => {
    const t = fileTarget({ path: 'a.ts', lines: 1 });
    expect(formatHoverTooltip(t, null)).toBe('a.ts  ·  1 lines');
  });
});

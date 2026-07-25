import { describe, it, expect } from 'vitest';
import { formatHoverTooltip, isDeletedTarget } from '@/city/interaction/tooltipText';
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

  it('prefers the scrubbed line count (Timeline) over the static FileNode.lines', () => {
    const t = fileTarget({ path: 'app/main.ts', lines: 42 }); // union max
    // scrubLines is the count at the scrubbed commit — the height's source.
    expect(formatHoverTooltip(t, 'codecity', 7)).toBe('/codecity/app/main.ts  ·  7 lines');
    // null (Live / no timeline) falls back to FileNode.lines.
    expect(formatHoverTooltip(t, 'codecity', null)).toBe('/codecity/app/main.ts  ·  42 lines');
  });

  it('renders a deleted file the count it is given (the at-deletion value)', () => {
    // scrubbedStatsFor resolves "what it measured when deleted"; this stays a
    // pure formatter and just prints what it is handed.
    const t = { ...fileTarget({ path: 'app/gone.py', lines: 0 }), isRuin: true } as PickTarget;
    expect(formatHoverTooltip(t, 'codecity', 214)).toBe('/codecity/app/gone.py  ·  214 lines');
  });

  it('keeps pixel dimensions on a deleted media file (intrinsic, not replayed)', () => {
    const t = {
      ...fileTarget({ path: 'app/logo.png', media_width: 800, media_height: 600 }),
      isRuin: true,
    } as PickTarget;
    expect(formatHoverTooltip(t, 'codecity', 0)).toBe('/codecity/app/logo.png  ·  800×600');
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

  it('leaves the identity text clean for a ghost-ruin (the deleted badge is a render concern)', () => {
    const f = { ...fileTarget({ path: 'a.ts', lines: 1 }), isRuin: true } as PickTarget;
    expect(formatHoverTooltip(f, 'r')).toBe('/r/a.ts  ·  1 lines');
    const d = {
      ...dirTarget({ path: 'app', children_file_count: 2, children_dir_count: 0 }),
      isRuin: true,
    } as PickTarget;
    expect(formatHoverTooltip(d, 'r')).toBe('/r/app  ·  2 files, 0 dirs');
  });
});

describe('isDeletedTarget', () => {
  it('flags a ghost-ruin file or dir, nothing else', () => {
    const ruin = { ...fileTarget({ path: 'a.ts', lines: 1 }), isRuin: true } as PickTarget;
    const ruinDir = {
      ...dirTarget({ path: 'app', children_file_count: 2, children_dir_count: 0 }),
      isRuin: true,
    } as PickTarget;
    expect(isDeletedTarget(ruin)).toBe(true);
    expect(isDeletedTarget(ruinDir)).toBe(true);
    expect(isDeletedTarget(fileTarget({ path: 'a.ts', lines: 1 }))).toBe(false);
    expect(isDeletedTarget(null)).toBe(false);
  });
});

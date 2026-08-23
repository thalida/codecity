import { describe, it, expect } from 'vitest';
import {
  hoverTooltipContent,
  isDeletedTarget,
  middleTruncatePath,
} from '@/city/scene/interaction/tooltip/text';
import { NodeKind } from '@/types';
import { commits as buildCommits } from '../../../_helpers/commits';
import type { FileNode, DirNode } from '@/types';
import type { PickTarget } from '@/city/scene/types/picker';

// The formatter reads a handful of fields but the types want the whole shape,
// so the rest are inert defaults.
function file(partial: Partial<FileNode>): FileNode {
  return {
    name: 'x',
    type: NodeKind.File,
    path: 'x',
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

describe('middleTruncatePath', () => {
  it('leaves a path that already fits', () => {
    expect(middleTruncatePath('/repo/app/src', 44)).toBe('/repo/app/src');
  });

  it('drops middle segments, keeping the root and the deepest folder', () => {
    const out = middleTruncatePath('/repo/app/src/layout/views/deeply/nested/here', 30);
    expect(out.startsWith('/repo/')).toBe(true);
    expect(out.endsWith('here')).toBe(true);
    expect(out).toContain('…');
    expect(out.length).toBeLessThanOrEqual(30);
  });

  it('cannot truncate a two-segment path, so it leaves it whole', () => {
    const long = '/averyveryverylongsingledirectorynamethatwontfit/leaf';
    expect(middleTruncatePath(long, 20)).toBe(long);
  });
});

describe('hoverTooltipContent', () => {
  it('returns null for no target', () => {
    expect(hoverTooltipContent(null, 'codecity')).toBeNull();
  });

  it('leads with the filename and puts its folder underneath', () => {
    const t = fileTarget({ name: 'main.ts', path: 'app/main.ts', lines: 42 });
    const c = hoverTooltipContent(t, 'codecity')!;
    expect(c.title).toBe('main.ts');
    expect(c.path).toBe('/codecity/app');
    expect(c.stats).toContain('42 lines');
  });

  it('leaves the dates to the pane, keeping the hover line short', () => {
    const t = fileTarget({
      name: 'main.ts',
      path: 'app/main.ts',
      lines: 42,
      modified: '2024-03-20T10:00:00Z',
      created: '2024-01-10T09:00:00Z',
    });
    const c = hoverTooltipContent(t, 'codecity')!;
    expect(c.stats.some((s) => s.startsWith('modified'))).toBe(false);
    expect(c.stats.some((s) => s.startsWith('created'))).toBe(false);
  });

  it('prefers the scrubbed line count (Timeline) over the static FileNode.lines', () => {
    const t = fileTarget({ name: 'main.ts', path: 'app/main.ts', lines: 42 }); // union max
    expect(hoverTooltipContent(t, 'codecity', 7)!.stats).toContain('7 lines');
    // null (Live / no timeline) falls back to FileNode.lines.
    expect(hoverTooltipContent(t, 'codecity', null)!.stats).toContain('42 lines');
  });

  it('renders a deleted file the count it is given (the at-deletion value)', () => {
    const t = {
      ...fileTarget({ name: 'gone.py', path: 'app/gone.py', lines: 0 }),
      isRuin: true,
    } as PickTarget;
    const c = hoverTooltipContent(t, 'codecity', 214)!;
    expect(c.stats).toContain('214 lines');
    expect(c.deleted).toBe(true);
  });

  it('shows pixel dimensions instead of line count for an image file', () => {
    const t = fileTarget({
      name: 'logo.png',
      path: 'app/logo.png',
      lines: 0,
      mediaKind: 'image',
      media_width: 1920,
      media_height: 1080,
    });
    const c = hoverTooltipContent(t, 'codecity')!;
    expect(c.stats).toContain('1920×1080');
    expect(c.stats.some((s) => s.includes('lines'))).toBe(false);
  });

  it('falls back to line count when a media file has no dimensions', () => {
    const t = fileTarget({ name: 'clip.mp4', path: 'app/clip.mp4', lines: 0, mediaKind: 'video' });
    expect(hoverTooltipContent(t, 'codecity')!.stats).toContain('0 lines');
  });

  it('names a directory and counts what is inside it', () => {
    const t = dirTarget({
      name: 'app',
      path: 'app',
      children_file_count: 3,
      descendants_file_count: 9,
      children_dir_count: 1,
      descendants_dir_count: 1,
    });
    const c = hoverTooltipContent(t, 'codecity')!;
    expect(c.title).toBe('app');
    // A folder named `app` and a file named `app` look alike without it.
    expect(c.stats[0]).toBe('directory');
    expect(c.stats.some((s) => s.includes('files'))).toBe(true);
  });

  it('titles the repo root with the root name and gives it no parent path', () => {
    const t = dirTarget({ name: '.', path: '.', children_file_count: 1, children_dir_count: 0 });
    const c = hoverTooltipContent(t, 'codecity')!;
    expect(c.title).toBe('codecity');
    expect(c.path).toBeUndefined();
  });

  it('drops the root segment when there is no root name', () => {
    const t = fileTarget({ name: 'a.ts', path: 'app/a.ts', lines: 1 });
    expect(hoverTooltipContent(t, null)!.path).toBe('app');
  });

  it('leads a commit with its subject, details beneath', () => {
    const t = {
      kind: NodeKind.Commit,
      commit: buildCommits({
        date: '2024-03-20T10:00:00Z',
        files: 6,
        sha: 'a7f3c9d1234567',
        authors: ['thalida'],
        subject: 'Widen the default tree canopy',
      })[0],
    } as PickTarget;
    const c = hoverTooltipContent(t, 'codecity')!;
    expect(c.title).toBe('Widen the default tree canopy');
    expect(c.stats).toContain('a7f3c9d');
    expect(c.stats).toContain('thalida');
    expect(c.stats).toContain('6 files');
  });

  it('falls back to the sha when a commit has no subject', () => {
    const t = {
      kind: NodeKind.Commit,
      commit: buildCommits({
        date: '2024-03-20T10:00:00Z',
        files: 1,
        sha: 'a7f3c9d1234567',
        authors: [],
        subject: '',
      })[0],
    } as PickTarget;
    expect(hoverTooltipContent(t, 'codecity')!.title).toBe('commit a7f3c9d');
  });

  it('names the reset affordance on the gem', () => {
    const c = hoverTooltipContent({ kind: NodeKind.Gem } as PickTarget, 'codecity')!;
    expect(c.title).toBe('codecity');
    expect(c.stats).toContain('click to reset view');
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

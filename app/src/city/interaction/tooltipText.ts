// city/interaction/tooltipText.ts — Pure formatting for the hover tooltip
// label. Given a pick target and the project's root directory name, returns
// the one-line string shown next to the cursor (or null when nothing should
// show). Kept side-effect-free so it's unit-testable in isolation; the live
// wiring in inputHandlers.ts reads the root name off the manifest signal and
// hands it in.

import { NodeKind } from '@/types';
import type { PickTarget } from '@/types';
import { formatRelativeAge } from '@/utils/dates';
import { ROOT_PATH } from '@/constants/manifest';

// Prepend the root directory name (with a leading slash) to a manifest-
// relative path so the tooltip reads as an absolute-looking path (e.g.
// "/codecity/app/main.ts" rather than "app/main.ts"). The root's own path is
// ROOT_PATH — we render just "/codecity", not "codecity/.".
function withRoot(relPath: string, rootName: string | null): string {
  if (!rootName) return relPath || '';
  if (!relPath || relPath === ROOT_PATH) return `/${rootName}`;
  return `/${rootName}/${relPath}`;
}

export function formatHoverTooltip(
  target: PickTarget | null,
  rootName: string | null
): string | null {
  if (!target) return null;
  if (target.kind === NodeKind.Gem) {
    // The gem represents the project root and also acts as the reset
    // button — clicking it clears the selection and recenters the
    // camera. Show both so the affordance is discoverable.
    return `${withRoot('', rootName)}  ·  click to reset view`;
  }
  if (target.kind === NodeKind.Commit) {
    const c = target.commit;
    const shortSha = c.sha.slice(0, 7);
    const filesLabel = `${c.files} file${c.files === 1 ? '' : 's'}`;
    return `commit ${shortSha}  ·  ${formatRelativeAge(c.date)}  ·  ${filesLabel}`;
  }
  if (target.kind === NodeKind.File && target.file) {
    const f = target.file;
    const fpath = withRoot(f.path || f.name || 'file', rootName);
    // Media files (images/video) are binary, so their line count is a
    // meaningless 0 — surface pixel dimensions instead. The backend only
    // stamps media_width/height on recognized media, so their presence is a
    // reliable "this is dimensioned media" signal.
    return f.media_width != null && f.media_height != null
      ? `${fpath}  ·  ${f.media_width}×${f.media_height}`
      : fpath + (f.lines != null ? `  ·  ${f.lines} lines` : '');
  }
  if (target.kind === NodeKind.Directory && target.dir) {
    const d = target.dir;
    const dpath = withRoot(d.path || d.name || '', rootName);
    // Show immediate-child counts (not descendants) — the tooltip is a
    // quick "what's directly inside here", not a subtree summary.
    const fileCount = d.children_file_count != null ? d.children_file_count : 0;
    const dirCount = d.children_dir_count != null ? d.children_dir_count : 0;
    const counts = `${fileCount} file${fileCount === 1 ? '' : 's'}, ${dirCount} dir${
      dirCount === 1 ? '' : 's'
    }`;
    return `${dpath || 'directory'}  ·  ${counts}`;
  }
  return null;
}

// Whether a hovered file/dir is a ghost-ruin (deleted at the scrubbed commit).
// The tooltip renderer leads with a red "deleted" badge for these, so the marker
// lives with the render, not in this identity-text formatter.
export function isDeletedTarget(target: PickTarget | null): boolean {
  if (target?.kind === NodeKind.File || target?.kind === NodeKind.Directory) {
    return Boolean(target.isRuin);
  }
  return false;
}

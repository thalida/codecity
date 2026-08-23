// city/interaction/tooltipText.ts — the hover tooltip's content, given a pick
// target and the root's name. Side-effect-free so it tests in isolation, and it
// shares the selection pane's stat builders, so hovering a building and
// selecting it cannot report different numbers.
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types';
import { formatRelativeAge } from '@/utils/dates';
import { ROOT_PATH } from '@/constants/manifest';
import { fileStatItems, directoryStatItems } from '@/utils/statItems';
import type { TimelineStore } from '@/state/stores/timeline';

/** Longest path rendered before the middle segments collapse to an ellipsis. */
const PATH_BUDGET_CHARS = 44;

export interface TooltipContent {
  /** Identity line: a filename, a folder name, or a commit subject. */
  title: string;
  /** Location line, already truncated. Absent where a path means nothing. */
  path?: string;
  /** Third line, joined with separators by the renderer. */
  stats: string[];
  /** Ruin at the scrubbed commit: the renderer leads with a red badge. */
  deleted: boolean;
}

// Root name + a leading slash, so a relative path reads absolute-looking. The
// root itself is ROOT_PATH, which renders "/codecity", not "codecity/.".
function withRoot(relPath: string, rootName: string | null): string {
  if (!rootName) return relPath || '';
  if (!relPath || relPath === ROOT_PATH) return `/${rootName}`;
  return `/${rootName}/${relPath}`;
}

/** The path minus its last segment: what the title line already shows. */
function parentOf(relPath: string): string {
  const cut = relPath.lastIndexOf('/');
  return cut === -1 ? '' : relPath.slice(0, cut);
}

/** Drop middle segments until it fits, keeping first and last: truncating the
 *  tail would hide the end nearest the file, which is the informative one. */
export function middleTruncatePath(path: string, budget = PATH_BUDGET_CHARS): string {
  if (path.length <= budget) return path;
  const lead = path.startsWith('/') ? '/' : '';
  const segments = path.slice(lead.length).split('/');
  if (segments.length <= 2) return path;

  // Walk inward from the middle, dropping one segment at a time.
  const kept = segments.slice();
  while (kept.length > 2) {
    kept.splice(Math.floor(kept.length / 2), 1);
    const candidate = `${lead}${kept[0]}/…/${kept.slice(1).join('/')}`;
    if (candidate.length <= budget) return candidate;
  }
  return `${lead}${kept[0]}/…/${kept[kept.length - 1]}`;
}

export function hoverTooltipContent(
  target: PickTarget | null,
  rootName: string | null,
  // Timeline: lines at the scrubbed commit, or at deletion for a file already
  // gone, and the history those come from.
  scrubLines?: number | null,
  timeline?: TimelineStore | null
): TooltipContent | null {
  if (!target) return null;
  const deleted = isDeletedTarget(target);

  if (target.kind === NodeKind.Gem) {
    // The gem represents the project root and also acts as the reset button, so
    // name the affordance to keep it discoverable.
    return { title: rootName ?? 'project', stats: ['click to reset view'], deleted: false };
  }

  if (target.kind === NodeKind.Commit) {
    const c = target.commit;
    const authors = c.authors.length > 0 ? c.authors[0] : null;
    const stats = [c.sha.slice(0, 7)];
    if (authors) stats.push(authors);
    stats.push(formatRelativeAge(c.date));
    stats.push(`${c.files} file${c.files === 1 ? '' : 's'}`);
    return { title: c.subject || `commit ${c.sha.slice(0, 7)}`, stats, deleted: false };
  }

  if (target.kind === NodeKind.File && target.file) {
    const f = target.file;
    const rel = f.path || f.name || 'file';
    const parent = parentOf(rel);
    // scrubLines wins where the replay has a value for this commit.
    const node = scrubLines != null ? { ...f, lines: scrubLines } : f;
    return {
      title: f.name || rel,
      path: middleTruncatePath(withRoot(parent, rootName)),
      stats: fileStatItems(node, { dates: false, timeline }).map((i) => i.text),
      deleted,
    };
  }

  if (target.kind === NodeKind.Directory && target.dir) {
    const d = target.dir;
    const rel = d.path || d.name || '';
    const isRoot = !rel || rel === ROOT_PATH;
    return {
      title: isRoot ? (rootName ?? 'root') : d.name || rel,
      path: isRoot ? undefined : middleTruncatePath(withRoot(parentOf(rel), rootName)),
      stats: directoryStatItems(d).map((i) => i.text),
      deleted,
    };
  }

  return null;
}

// Whether a hovered file/dir is a ghost-ruin (deleted at the scrubbed commit).
export function isDeletedTarget(target: PickTarget | null): boolean {
  if (target?.kind === NodeKind.File || target?.kind === NodeKind.Directory) {
    return Boolean(target.isRuin);
  }
  return false;
}

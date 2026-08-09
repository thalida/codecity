// components/PaneStats/statItems.ts — Builds the stat rows the file and road
// panes hand to <PaneStats>. Pure: the caller supplies the node, so the same
// formatting rules serve both panes without either reaching for the picker.

import type { FileNode, DirNode } from '@/types';
import { formatShortDate, formatRelativeAgeShort } from '@/utils/dates';
import { formatBytes } from '@/utils/bytes';
import { humanLanguageFor } from '@/utils/syntaxLanguages';
import { scrubbedStatsFor } from '@/state/stores/presentPaths';
import type { PaneStatItem } from './PaneStats';

/**
 * Direct-children and recursive-descendant counts as one item. They collapse to
 * a single number when they match (a leaf-ish folder); otherwise the recursive
 * total follows in parentheses, e.g. `12 files (1375 total)`.
 */
function countItem(
  direct: number | null | undefined,
  total: number | null | undefined,
  label: string
): PaneStatItem | null {
  if (direct == null && total == null) return null;
  if (direct == null) return { text: `${total} ${label}`, title: `${total} total` };
  if (total == null || direct === total) {
    return { text: `${direct} ${label}`, title: `${direct} direct children` };
  }
  return {
    text: `${direct} ${label} (${total} total)`,
    title: `${direct} direct · ${total} total in this subtree`,
  };
}

/** Relative age with the exact date as its tooltip. */
function ageItem(iso: string, label: string, now: number): PaneStatItem {
  return {
    text: `${label} ${formatRelativeAgeShort(new Date(iso).getTime(), now)}`,
    title: `${label} ${formatShortDate(iso)}`,
  };
}

export function fileStatItems(file: FileNode, now: number = Date.now()): PaneStatItem[] {
  const items: PaneStatItem[] = [];
  // In Timeline the static node carries max-over-history values, so the replayed
  // ones win where they exist (at deletion for a file already gone).
  const scrubbed = file.path != null ? scrubbedStatsFor(file.path) : null;
  const lines = scrubbed ? scrubbed.lines : file.lines;
  const size = scrubbed ? scrubbed.bytes : file.size;

  const language = humanLanguageFor(file);
  if (language) items.push({ text: language });
  if (lines != null) items.push({ text: `${lines} lines` });
  if (size != null) items.push({ text: formatBytes(size) });
  if (file.modified) items.push(ageItem(file.modified, 'modified', now));
  if (file.created) items.push(ageItem(file.created, 'created', now));
  return items;
}

export function directoryStatItems(dir: DirNode): PaneStatItem[] {
  const items: PaneStatItem[] = [];
  const files = countItem(dir.children_file_count, dir.descendants_file_count, 'files');
  if (files) items.push(files);
  const dirs = countItem(dir.children_dir_count, dir.descendants_dir_count, 'dirs');
  if (dirs) items.push(dirs);
  if (dir.descendants_size != null) items.push({ text: formatBytes(dir.descendants_size) });
  return items;
}

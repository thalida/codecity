// components/PaneStats/statItems.ts — Builds the stat rows the file and road
// panes hand to <PaneStats>. Pure: the caller supplies the node, so the same
// formatting rules serve both panes without either reaching for the picker.

import type { FileNode, DirNode } from '@/types';
import { formatShortDate, formatRelativeAgeShort, parseDateMs } from '@/utils/dates';
import { formatBytes } from '@/utils/format';
import { humanLanguageFor } from '@/utils/syntaxLanguages';
import { scrubbedStatsFor } from '@/state/stores/timeline';
import type { PaneStatItem } from './PaneStats';

/** Direct and recursive counts as one item, collapsing to a single number when
 *  a folder has no subfolders to distinguish them. */
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
    text: `${label} ${formatRelativeAgeShort(parseDateMs(iso), now)}`,
    title: `${label} ${formatShortDate(iso)}`,
  };
}

export interface FileStatOpts {
  /** Include the created/modified ages. The hover tooltip drops them to stay
   *  to a single line; the pane has the room. Defaults to true. */
  dates?: boolean;
  /** Reference point for the relative ages. Defaults to now. */
  now?: number;
}

export function fileStatItems(file: FileNode, opts: FileStatOpts = {}): PaneStatItem[] {
  const { dates = true, now = Date.now() } = opts;
  const items: PaneStatItem[] = [];
  // In Timeline the static node carries max-over-history values, so the replayed
  // ones win where they exist (at deletion for a file already gone).
  const scrubbed = file.path != null ? scrubbedStatsFor(file.path) : null;
  const lines = scrubbed ? scrubbed.lines : file.lines;
  const size = scrubbed ? scrubbed.bytes : file.size;

  // Shrink weights set the give-way order when the row runs short: the language
  // first (the header's type badge repeats it), then the ages, numbers last.
  const language = humanLanguageFor(file);
  if (language) items.push({ text: language, shrink: 200 });
  // A media file's line count is a meaningless 0, so its dimensions are the
  // size worth showing. The backend stamps those only when it recognised it.
  if (file.media_width != null && file.media_height != null) {
    items.push({ text: `${file.media_width}×${file.media_height}` });
  } else if (lines != null) {
    items.push({ text: `${lines} lines` });
  }
  if (size != null) items.push({ text: formatBytes(size) });
  if (dates) {
    if (file.modified) items.push({ ...ageItem(file.modified, 'modified', now), shrink: 20 });
    if (file.created) items.push({ ...ageItem(file.created, 'created', now), shrink: 60 });
  }
  return items;
}

export function directoryStatItems(dir: DirNode): PaneStatItem[] {
  // Lead with the kind: a folder named `app` and a file named `app` look alike,
  // and the counts that follow only make sense once you know which this is.
  const items: PaneStatItem[] = [{ text: 'directory', shrink: 200 }];
  const files = countItem(dir.children_file_count, dir.descendants_file_count, 'files');
  if (files) items.push(files);
  const dirs = countItem(dir.children_dir_count, dir.descendants_dir_count, 'dirs');
  if (dirs) items.push(dirs);
  if (dir.descendants_size != null) items.push({ text: formatBytes(dir.descendants_size) });
  return items;
}

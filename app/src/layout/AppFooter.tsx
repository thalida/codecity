// layout/AppFooter.tsx — Sitewide bottom status bar. Two sections:
//   left   — combined status indicator: [dot] detail-text
//            One dot, two channels of state:
//              color    — rebuild state (green=idle, yellow=rebuilding,
//                         red=error)
//              animation — live state (slow heartbeat when polling on,
//                         static when paused, fast pulse when rebuilding,
//                         static when error)
//            A detail <span> next to the dot shows human-readable status
//            ("rebuilt 5s ago", "rebuilding…", "error: <msg>", "paused").
//            title= on the wrapper is a fallback tooltip for narrow widths.
//   right  — current selection metadata (language · lines · size · created
//            · modified for files; file/dir counts + size for directories)
//
// The refresh/reset-view button has moved to the header (far right).

import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { NodeKind } from '@/types';
import { formatShortDate, formatRelativeAgeShort } from '@/utils/dates';
import { formatBytes } from '@/utils/bytes';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import {
  REBUILD_STATUS,
  RebuildStatus,
  LAST_REBUILD_ERROR,
  LAST_UPDATED_AT,
} from '@/state/stores/manifest';
import { humanLanguageFor } from '@/utils/syntaxLanguages';

interface FooterFileSelection {
  kind: NodeKind.File;
  /** File extension (with leading dot, e.g. ".ts"). Drives the color of the path-badge pill. */
  extension?: string;
  language?: string;
  lines?: number | null;
  size?: number | null;
  modified?: string | null;
  created?: string | null;
}

interface FooterDirectorySelection {
  kind: NodeKind.Directory;
  /** Files that are direct children of this directory. */
  directFiles?: number | null;
  /** All files recursively under this directory. */
  totalFiles?: number | null;
  /** Subdirectories that are direct children of this directory. */
  directDirs?: number | null;
  /** All subdirectories recursively under this directory. */
  totalDirs?: number | null;
  /** Total bytes of all descendant files. */
  size?: number | null;
}

export type FooterSelection = FooterFileSelection | FooterDirectorySelection;

export interface FooterStatus {
  /** True when live-poll is active; renders as `live`. False renders as `paused`. */
  liveEnabled: boolean;
  /** The current world-rebuild status; shared type from `state/stores/manifest.ts`. */
  rebuildStatus: RebuildStatus;
  /** Epoch millis of the most recent successful rebuild; 0 ⇒ unknown. */
  lastUpdatedAt: number;
  /** Surfaced as the indicator's `title` (hover tooltip) when rebuildStatus is Error. */
  errorMessage: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a directory-count item showing both direct-children and recursive
 * descendant counts. When the two counts match (leaf-ish dirs) it renders
 * just the single number. When they differ, the recursive total appears in
 * parentheses after the direct count: e.g. `12 files (1375 total)`.
 *
 * Returns null if both counts are absent.
 */
function _directoryCountItem(
  direct: number | null | undefined,
  total: number | null | undefined,
  label: string
): { text: string; title?: string } | null {
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

// ── Preact component ─────────────────────────────────────────────────────────

interface FooterItemData {
  text: string;
  title?: string;
}

function FooterItem({ text, title }: FooterItemData) {
  return (
    <span class="app-footer-item" title={title ?? ''}>
      {text}
    </span>
  );
}

function FooterSep() {
  return <span class="app-footer-sep">·</span>;
}

interface FooterStatusSectionProps {
  status: FooterStatus | null;
}

// CSS modifier classes for the combined status dot/detail (see styles.css).
// Named so the className composition reads without inline magic strings.
enum BuildClass {
  Rebuilding = 'is-rebuilding',
  Ready = 'is-ready',
  Error = 'is-error',
}
enum LiveClass {
  Live = 'is-live',
  Paused = 'is-paused',
}

// Static detail-text copy. Dynamic variants (relative age, "error: <msg>") are
// composed inline below.
const DETAIL_TEXT = {
  rebuilding: 'rebuilding…',
  decorating: 'decorating…',
  error: 'error',
  // Guard for unit tests / any path that reads status before LAST_UPDATED_AT
  // is seeded.
  ready: 'ready',
} as const;

function FooterStatusSection({ status }: FooterStatusSectionProps) {
  if (!status) return <span class="app-footer-status" />;

  let buildClass: BuildClass;
  let detailText: string;
  switch (status.rebuildStatus) {
    case RebuildStatus.Rebuilding:
      buildClass = BuildClass.Rebuilding;
      detailText = DETAIL_TEXT.rebuilding;
      break;
    case RebuildStatus.Decorating:
      buildClass = BuildClass.Rebuilding;
      detailText = DETAIL_TEXT.decorating;
      break;
    case RebuildStatus.Error:
      buildClass = BuildClass.Error;
      detailText = status.errorMessage ? `error: ${status.errorMessage}` : DETAIL_TEXT.error;
      break;
    default: // Idle
      buildClass = BuildClass.Ready;
      detailText =
        status.lastUpdatedAt > 0
          ? formatRelativeAgeShort(status.lastUpdatedAt, Date.now())
          : DETAIL_TEXT.ready;
  }

  const liveClass = status.liveEnabled ? LiveClass.Live : LiveClass.Paused;

  // Compose hover tooltip
  const liveLabel = `Live updates: ${status.liveEnabled ? 'on' : 'off'}`;
  let titleText: string;
  if (status.rebuildStatus === RebuildStatus.Error && status.errorMessage) {
    titleText = `${liveLabel} · error: ${status.errorMessage}`;
  } else if (status.rebuildStatus === RebuildStatus.Idle && status.lastUpdatedAt > 0) {
    titleText = `${liveLabel} · rebuilt ${detailText}`;
  } else if (status.rebuildStatus === RebuildStatus.Rebuilding) {
    titleText = `${liveLabel} · ${DETAIL_TEXT.rebuilding}`;
  } else {
    titleText = liveLabel;
  }

  return (
    <span
      class={`app-footer-status ${buildClass} ${liveClass}`}
      title={titleText}
      aria-label={titleText}
    >
      <span class="app-footer-status-dot" />
      <span class="app-footer-status-detail">{detailText}</span>
    </span>
  );
}

interface FooterSelectionSectionProps {
  selection: FooterSelection | null;
}

function FooterSelectionSection({ selection }: FooterSelectionSectionProps) {
  if (!selection) return null;

  const items: FooterItemData[] = [];
  if (selection.kind === NodeKind.File) {
    if (selection.language) items.push({ text: selection.language });
    if (selection.lines != null) items.push({ text: `${selection.lines} lines` });
    if (selection.size != null) items.push({ text: formatBytes(selection.size) });
    if (selection.modified) {
      const relMod = `modified ${formatRelativeAgeShort(new Date(selection.modified).getTime(), Date.now())}`;
      const absMod = `modified ${formatShortDate(selection.modified)}`;
      items.push({ text: relMod, title: absMod });
    }
    if (selection.created) {
      const relCre = `created ${formatRelativeAgeShort(new Date(selection.created).getTime(), Date.now())}`;
      const absCre = `created ${formatShortDate(selection.created)}`;
      items.push({ text: relCre, title: absCre });
    }
  } else if (selection.kind === NodeKind.Directory) {
    items.push({ text: 'Directory' });
    const filesItem = _directoryCountItem(selection.directFiles, selection.totalFiles, 'files');
    if (filesItem) items.push(filesItem);
    const dirsItem = _directoryCountItem(selection.directDirs, selection.totalDirs, 'dirs');
    if (dirsItem) items.push(dirsItem);
    if (selection.size != null) items.push({ text: formatBytes(selection.size) });
  }

  return (
    <>
      {items.map((item, i) => (
        <>
          {i > 0 && <FooterSep />}
          <FooterItem key={i} {...item} />
        </>
      ))}
    </>
  );
}

// ── Self-reading AppFooter component ────────────────────────────────────────
// Reads status signals and picker state directly; no props needed when
// mounted from App.tsx. A 1-second tick signal drives the relative-age text.

export function AppFooter() {
  // 1-second tick so relative timestamps ("5s ago") advance smoothly.
  // useSignal creates a component-local signal; writing it triggers a
  // fine-grained re-render of only this component.
  const tick = useSignal(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      tick.value = tick.peek() + 1;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Status — reads all four status signals (auto-tracked in render)
  void tick.value; // ensure 1-second re-renders for relative timestamps
  const status: FooterStatus = {
    liveEnabled: LIVE_UPDATES.value.ENABLED,
    rebuildStatus: REBUILD_STATUS.value,
    lastUpdatedAt: LAST_UPDATED_AT.value,
    errorMessage: LAST_REBUILD_ERROR.value,
  };

  // Selection — hover takes priority over selection (same rule as coordinator).
  // Reading SCENE_HANDLE.value establishes tracking so AppFooter re-renders
  // when the scene first becomes available (CenterPane mount). Then
  // picker.hover.value and picker.selection.value are tracked for fine-grained
  // re-renders on each hover/select change.
  const handle = SCENE_HANDLE.value;
  const hov = handle?.picker.hover.value ?? null;
  const sel = handle?.picker.selection.value ?? null;
  const target = hov ?? sel;

  let selection: FooterSelection | null = null;
  if (target?.kind === NodeKind.File) {
    const f = target.file;
    selection = {
      kind: NodeKind.File,
      extension: f.extension || '',
      language: humanLanguageFor(f),
      lines: f.lines,
      size: f.size || 0,
      modified: f.modified || null,
      created: f.created || null,
    };
  } else if (target?.kind === NodeKind.Directory) {
    const d = target.dir;
    selection = {
      kind: NodeKind.Directory,
      directFiles: d.children_file_count ?? 0,
      totalFiles: d.descendants_file_count ?? 0,
      directDirs: d.children_dir_count ?? 0,
      totalDirs: d.descendants_dir_count ?? 0,
      size: d.descendants_size ?? 0,
    };
  }

  return (
    <footer id="app-footer">
      <div class="app-footer-section app-footer-left">
        <FooterStatusSection status={status} />
      </div>
      <div class="app-footer-section app-footer-right">
        <FooterSelectionSection selection={selection} />
      </div>
    </footer>
  );
}

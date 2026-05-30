// views/shell/appFooter.tsx — Sitewide bottom status bar. Two sections:
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

import { h } from 'preact';
import { signal, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { DateSource, NodeKind } from '@/types';
import { formatShortDate, formatRelativeAgeShort } from '@/utils/dates';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { LIVE_UPDATES } from '@/state/settings/index';
import { REBUILD_STATUS, LAST_REBUILD_ERROR, LAST_UPDATED_AT } from '@/state/runtime/liveStatus';
import { humanLanguageFor } from '@/views/panes/filePreviewPane';

interface FooterFileSelection {
  kind: NodeKind.File;
  /** File extension (with leading dot, e.g. ".ts"). Drives the color of the path-badge pill. */
  extension?: string;
  language?: string;
  lines?: number | null;
  size?: number | null;
  modified?: string | null;
  created?: string | null;
  dateSource?: DateSource;
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
  /** Must remain in sync with `RebuildStatus` in `liveStatus.ts` (intentional decoupling). */
  rebuildStatus: 'idle' | 'rebuilding' | 'decorating' | 'error';
  /** Epoch millis of the most recent successful rebuild; 0 ⇒ unknown. */
  lastUpdatedAt: number;
  /** Surfaced as the indicator's `title` (hover tooltip) when rebuildStatus === 'error'. */
  errorMessage: string | null;
}

interface AppFooterState {
  selection: FooterSelection | null;
  status: FooterStatus | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
function _formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

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
  source?: string;
  title?: string;
}

function FooterItem({ text, source, title }: FooterItemData) {
  return (
    <span class="app-footer-item" title={title ?? ''}>
      {text}
      {source && <span class="app-footer-source">({source})</span>}
    </span>
  );
}

function FooterSep() {
  return <span class="app-footer-sep">·</span>;
}

interface FooterStatusSectionProps {
  status: FooterStatus | null;
}

function FooterStatusSection({ status }: FooterStatusSectionProps) {
  if (!status) return <span class="app-footer-status" />;

  let buildModifier: 'is-rebuilding' | 'is-ready' | 'is-error';
  let detailText: string;
  if (status.rebuildStatus === 'rebuilding') {
    buildModifier = 'is-rebuilding';
    detailText = 'rebuilding…';
  } else if (status.rebuildStatus === 'decorating') {
    buildModifier = 'is-rebuilding';
    detailText = 'decorating…';
  } else if (status.rebuildStatus === 'error') {
    buildModifier = 'is-error';
    detailText = status.errorMessage ? `error: ${status.errorMessage}` : 'error';
  } else {
    buildModifier = 'is-ready';
    // 'ready' literal is a guard for unit tests or any code path that
    // calls setStatus before LAST_UPDATED_AT is seeded.
    detailText =
      status.lastUpdatedAt > 0
        ? formatRelativeAgeShort(status.lastUpdatedAt, Date.now())
        : 'ready';
  }

  const liveModifier = status.liveEnabled ? 'is-live' : 'is-paused';

  // Compose hover tooltip
  const liveLabel = `Live updates: ${status.liveEnabled ? 'on' : 'off'}`;
  let titleText: string;
  if (status.rebuildStatus === 'error' && status.errorMessage) {
    titleText = `${liveLabel} · error: ${status.errorMessage}`;
  } else if (status.rebuildStatus === 'idle' && status.lastUpdatedAt > 0) {
    titleText = `${liveLabel} · rebuilt ${detailText}`;
  } else if (status.rebuildStatus === 'rebuilding') {
    titleText = `${liveLabel} · rebuilding…`;
  } else {
    titleText = liveLabel;
  }

  return (
    <span
      class={`app-footer-status ${buildModifier} ${liveModifier}`}
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
    if (selection.size != null) items.push({ text: _formatBytes(selection.size) });
    if (selection.modified) {
      const relMod = `modified ${formatRelativeAgeShort(new Date(selection.modified).getTime(), Date.now())}`;
      const absMod = `modified ${formatShortDate(selection.modified)}`;
      items.push({ text: relMod, source: selection.dateSource, title: absMod });
    }
    if (selection.created) {
      const relCre = `created ${formatRelativeAgeShort(new Date(selection.created).getTime(), Date.now())}`;
      const absCre = `created ${formatShortDate(selection.created)}`;
      items.push({ text: relCre, source: selection.dateSource, title: absCre });
    }
  } else if (selection.kind === NodeKind.Directory) {
    items.push({ text: 'Directory' });
    const filesItem = _directoryCountItem(selection.directFiles, selection.totalFiles, 'files');
    if (filesItem) items.push(filesItem);
    const dirsItem = _directoryCountItem(selection.directDirs, selection.totalDirs, 'dirs');
    if (dirsItem) items.push(dirsItem);
    if (selection.size != null) items.push({ text: _formatBytes(selection.size) });
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

  // Selection — hover takes priority over selection (same rule as coordinator)
  // Use .peek() on the SCENE_HANDLE signal for the picker refs themselves
  // to avoid re-rendering AppFooter when the entire handle is swapped —
  // only the .value reads of hover/selection should track.
  const handle = SCENE_HANDLE.value;
  const hov = handle?.picker.hover.value ?? null;
  const sel = handle?.picker.selection.value ?? null;
  const target = hov ?? sel;

  let selection: FooterSelection | null = null;
  if (target?.kind === NodeKind.File) {
    const f = target.file;
    const hasGit = !!(f.git && (f.git.created || f.git.modified));
    selection = {
      kind: NodeKind.File,
      extension: f.extension || '',
      language: humanLanguageFor(f),
      lines: f.lines,
      size: f.size || 0,
      modified: (f.git && f.git.modified) || f.modified || null,
      created: (f.git && f.git.created) || f.created || null,
      dateSource: hasGit ? DateSource.Git : DateSource.Filesystem,
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
    <>
      <div class="app-footer-section app-footer-left">
        <FooterStatusSection status={status} />
      </div>
      <div class="app-footer-section app-footer-right">
        <FooterSelectionSection selection={selection} />
      </div>
    </>
  );
}

// ── Props-driven AppFooter (used by the backward-compat shim) ────────────────

interface _AppFooterPropsLegacy {
  state: ReadonlySignal<AppFooterState>;
}

function _AppFooterLegacy({ state }: _AppFooterPropsLegacy) {
  const s = state.value;
  return (
    <>
      <div class="app-footer-section app-footer-left">
        <FooterStatusSection status={s.status} />
      </div>
      <div class="app-footer-section app-footer-right">
        <FooterSelectionSection selection={s.selection} />
      </div>
    </>
  );
}

// ── Backward-compat shim ──────────────────────────────────────────────────────
// Phase 3e will delete this once App.tsx mounts <AppFooter /> directly.

const NOOP_API = {
  setSelection(_sel: FooterSelection | null) {},
  setStatus(_status: FooterStatus) {},
};

type InitAppFooterOpts = Record<string, never>;

/**
 * Initialise the sitewide footer. Returns:
 *   setStatus({ liveEnabled, rebuildStatus, lastUpdatedAt, errorMessage })
 *                                            — right section (combined indicator)
 *   setSelection(sel | null)                 — left section (badge + metadata)
 *
 * The leading path-badge reads palette + asphalt from the live config
 * stores at render time and re-renders on any change, so editing an
 * extension hue or the asphalt color in Controls repaints the pill.
 */
export function initAppFooter(_opts: InitAppFooterOpts = {}) {
  const footer = document.getElementById('app-footer');
  if (!footer) return NOOP_API;

  const state = signal<AppFooterState>({ selection: null, status: null });
  render(<_AppFooterLegacy state={state} />, footer);

  function setStatus(status: FooterStatus): void {
    state.value = { ...state.value, status };
  }

  function setSelection(sel: FooterSelection | null): void {
    state.value = { ...state.value, selection: sel };
  }

  return { setSelection, setStatus };
}

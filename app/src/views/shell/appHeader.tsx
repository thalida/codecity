// views/shell/appHeader.tsx — Sitewide top header. Layout (left → right):
//   refresh (gem) icon button   — far left
//   project button (icon + label + @branch pill) → opens source picker
//   repo link icon (if git url)
//   #app-title slot: chip + path breadcrumb + copy button   — center
//
// When no path is selected (or only the root), #app-title is empty.

import { Fragment } from 'preact';
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ASPHALT, BUILDING_PALETTE } from '@/state/settings';
import { LucideIcon, GemIcon } from '../components/icon';
import { ExtensionBadge } from '../components/badge';
import { toHttpsRepoUrl } from '@/utils/sources';
import { fitSegments } from '../components/pathTruncate';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { SOURCE_INFO } from '@/state/runtime/sourceInfo';
import { openSourcePicker } from '@/state/runtime/uiState';
import { NodeKind } from '@/types';

// How long the "Copied!" badge lingers after the copy button is clicked.
const COPY_FEEDBACK_DURATION_MS = 1500;

export type HeaderSelection =
  | {
      kind: 'file' | 'dir';
      path: string;
      fullPath?: string;
      extension?: string;
      isDir?: boolean;
    }
  | {
      kind: 'commit';
      sha: string;
      authors: string[];
    };

interface InitAppHeaderOpts {
  /** project name shown in the project button on the left */
  rootLabel?: string;
  /** the path string the segment-click handler should receive when the root is clicked (e.g. "." or "") */
  rootPath?: string;
  /** fn(path:string) — fires when the user clicks a breadcrumb segment. Caller selects the matching node. */
  onSegmentClick?: ((path: string) => void) | null;
  /** fires when the user clicks the project button in the header */
  onSwitchSource?: () => void;
  /** Fires when the user clicks the reset-view (gem) button in the header
   *  (far left). Mirrors the R keyboard shortcut and clicking the gem in
   *  the city. Caller must pass the same mode-aware reset function used by
   *  the canvas-side input handlers, so all entry points stay consistent. */
  onResetView?: () => void;
  /** fires when the user clicks the focus button next to the selected path —
   *  mirrors pressing F on the canvas. Caller looks at the current selection
   *  and calls rig.focusBuilding / rig.focusStreet as appropriate. */
  onFocus?: () => void;
  /** Branch name when the loaded source is a git URL with an explicit branch. */
  branch?: string;
  /** Original src URL when the loaded source is a git URL — used to render the open-repo link next to the project button. */
  sourceUrl?: string;
}

interface AppHeaderState {
  selection: HeaderSelection | null;
  rootLabel: string;
  rootPath: string;
  branch: string | undefined;
  sourceUrl: string | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _copy(text: string, btn: HTMLButtonElement): void {
  function flash() {
    if (!btn) return;
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.classList.remove('is-copied');
    }, COPY_FEEDBACK_DURATION_MS);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, () => {
      _fallbackCopy(text);
      flash();
    });
  } else {
    _fallbackCopy(text);
    flash();
  }
}

/**
 * Append a branch-tree path to a forge HTTPS URL so the external-link
 * icon opens the branch instead of the repo root.
 */
function _withBranchPath(repoHttpsUrl: string, branch: string): string {
  const ref = encodeURIComponent(branch);
  if (/codeberg\.org|forgejo|gitea/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/src/branch/${ref}`;
  }
  if (/github\.com|sr\.ht/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/tree/${ref}`;
  }
  if (/gitlab\.com/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/-/tree/${ref}`;
  }
  if (/bitbucket\.org/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/src/${ref}`;
  }
  return repoHttpsUrl;
}

function _fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch (_) {
    /* fallback unavailable */
  }
  document.body.removeChild(ta);
}

// ── Preact sub-components ─────────────────────────────────────────────────────

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label = 'Copy path' }: CopyButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      class="btn-icon btn-icon--no-drag"
      title={label}
      aria-label={label}
      onClick={() => {
        if (ref.current) _copy(text, ref.current);
      }}
    >
      <LucideIcon name="copy" />
    </button>
  );
}

// Sub-component: the breadcrumb / title slot content
function HeaderTitle({
  sel,
  rootLabel,
  rootPath,
  onSegmentClick,
  onFocus,
}: {
  sel: HeaderSelection | null;
  rootLabel: string;
  rootPath: string;
  onSegmentClick?: ((path: string) => void) | null;
  onFocus?: () => void;
}) {
  const crumbsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!crumbsRef.current) return;
    const crumbsEl = crumbsRef.current;
    const segEls = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-seg'));
    const sepEls = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-sep'));
    fitSegments(crumbsEl, segEls, sepEls);

    // Observe the header row for resize events
    const parentRow = crumbsEl.closest('header, [id]') as HTMLElement | null;
    if (!parentRow) return;
    const ro = new ResizeObserver(() => {
      const s = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-seg'));
      const sep = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-sep'));
      fitSegments(crumbsEl, s, sep);
    });
    ro.observe(parentRow);
    return () => ro.disconnect();
  }, [sel]);

  if (!sel) return null;

  const focusTitle =
    sel.kind === 'commit' ? 'Focus camera on commit (F)' : 'Focus camera on selection (F)';
  const focusBtn = onFocus ? (
    <button
      type="button"
      class="btn-icon btn-icon--no-drag"
      title={focusTitle}
      aria-label={focusTitle}
      onClick={() => onFocus()}
    >
      <LucideIcon name="focus" />
    </button>
  ) : null;

  if (sel.kind === 'commit') {
    const primary = sel.authors[0] || '(unknown)';
    const coAuthorCount = Math.max(0, sel.authors.length - 1);
    const authorText = coAuthorCount > 0 ? ` · ${primary} (+${coAuthorCount})` : ` · ${primary}`;
    return (
      <>
        {focusBtn}
        {'Commit '}
        <span class="app-header-commit-sha">{sel.sha.slice(0, 7)}</span>
        <span class="app-header-commit-author">{authorText}</span>
        <CopyButton text={sel.sha} label="Copy SHA" />
      </>
    );
  }

  // file | dir branch
  const hasSel = !!(sel.path && sel.path !== rootPath);
  if (!hasSel) return null;

  // Palette reads — auto-tracked via .value in render
  const huePalette = BUILDING_PALETTE.value.HUE_EXT_MAP || {};
  const asphaltColor = ASPHALT.value.COLOR;
  const isFileSel = !sel.isDir;
  const segs = sel.path.split('/').filter(Boolean);
  let acc = '';

  return (
    <>
      {focusBtn}
      <ExtensionBadge
        extension={isFileSel ? (sel.extension ?? null) : null}
        isDir={!isFileSel}
        huePalette={huePalette}
        asphaltColor={asphaltColor}
      />
      <div
        ref={crumbsRef}
        class="app-header-crumbs"
        title={`${rootLabel}/${sel.path}`}
      >
        {segs.map((seg, i) => {
          acc = acc ? `${acc}/${seg}` : seg;
          const segPath = acc;
          const isLeaf = i === segs.length - 1;
          return (
            <Fragment key={`seg-${i}`}>
              {i > 0 && (
                <span class="app-header-sep">›</span>
              )}
              <button
                type="button"
                class={`btn-icon btn-icon--text btn-icon--no-drag app-header-seg${isLeaf ? ' is-leaf' : ''}`}
                onClick={() => {
                  if (onSegmentClick) onSegmentClick(segPath);
                }}
              >
                {seg}
              </button>
            </Fragment>
          );
        })}
      </div>
      <CopyButton text={sel.path} />
    </>
  );
}

// Sub-component: the left-side controls (gem + project chip + repo link)
function HeaderLeft({
  rootLabel,
  branch,
  sourceUrl,
  onResetView,
  onSwitchSource,
}: {
  rootLabel: string;
  branch: string | undefined;
  sourceUrl: string | undefined;
  onResetView?: () => void;
  onSwitchSource?: () => void;
}) {
  const repoLinkHref = sourceUrl
    ? branch
      ? _withBranchPath(toHttpsRepoUrl(sourceUrl), branch)
      : toHttpsRepoUrl(sourceUrl)
    : null;
  const repoLinkTitle = sourceUrl
    ? branch
      ? `Open repo at @${branch}`
      : `Open repo: ${sourceUrl}`
    : null;

  return (
    <>
      {onResetView && (
        <button
          type="button"
          class="btn-icon btn-icon--no-drag"
          title="Reset view (R)"
          aria-label="Reset view"
          data-app-header-injected="1"
          onClick={() => onResetView()}
        >
          <GemIcon />
        </button>
      )}
      {rootLabel && (
        <button
          type="button"
          class="btn-chip"
          title="Switch project"
          aria-label="Switch project"
          data-app-header-injected="1"
          disabled={!onSwitchSource}
          onClick={() => {
            if (onSwitchSource) onSwitchSource();
          }}
        >
          <LucideIcon name="map" />
          <span class="btn-chip-label">{rootLabel}</span>
          {branch && <span class="app-header-branch-pill">@{branch}</span>}
          <LucideIcon name="chevron-down" class="btn-chip-chevron" />
        </button>
      )}
      {repoLinkHref && (
        <a
          class="btn-icon btn-icon--link btn-icon--no-drag"
          href={repoLinkHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open repository in a new tab"
          title={repoLinkTitle ?? ''}
          data-app-header-injected="1"
        >
          <LucideIcon name="external-link" />
        </a>
      )}
    </>
  );
}

// ── Full AppHeader component ─────────────────────────────────────────────────
// Self-reading: derives all display state from runtime signals so no props
// need to be threaded from App.tsx. Only callbacks (actions) are props.

export interface AppHeaderProps {
  /** Fires when the user clicks a breadcrumb segment. */
  onSegmentClick?: ((path: string) => void) | null;
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
  /** Fires when the user clicks the reset-view (gem) button. */
  onResetView?: () => void;
  /** Fires when the user clicks the focus button next to the selected path. */
  onFocus?: () => void;
}

export function AppHeader({
  onSegmentClick,
  onSwitchSource,
  onResetView,
  onFocus,
}: AppHeaderProps = {}) {
  // Source info from runtime signal — label, branch, sourceUrl
  const si = SOURCE_INFO.value;

  // Derive selection from picker signal (auto-tracked in render)
  const handle = SCENE_HANDLE.value;
  const pickerSel = handle?.picker.selection.value ?? null;
  const rootNode = handle?.world.getRoot() ?? null;
  const rootPath = rootNode?.path ?? '';

  let sel: HeaderSelection | null = null;
  if (pickerSel?.kind === NodeKind.Commit) {
    sel = { kind: 'commit', sha: pickerSel.commit.sha, authors: pickerSel.commit.authors };
  } else if (pickerSel?.kind === NodeKind.File) {
    const node = pickerSel.file;
    sel = {
      kind: 'file',
      path: node.path || node.fullPath || node.name || '',
      fullPath: node.fullPath || '',
      extension: node.extension || '',
      isDir: false,
    };
  } else if (pickerSel?.kind === NodeKind.Directory) {
    const node = pickerSel.dir;
    sel = {
      kind: 'dir',
      path: node.path || node.fullPath || node.name || '',
      fullPath: node.fullPath || '',
      isDir: true,
    };
  }

  // AppHeader owns its <header> tag and the 3-column grid (see styles.css
  // #app-header rule for the layout). #app-header-right is reserved for
  // future right-side controls.
  return (
    <header id="app-header">
      <div id="app-header-left">
        <HeaderLeft
          rootLabel={si.label}
          branch={si.branch}
          sourceUrl={si.sourceUrl}
          onResetView={onResetView}
          onSwitchSource={onSwitchSource ?? (() => openSourcePicker({ dismissible: true }))}
        />
      </div>
      <div id="app-title">
        <HeaderTitle
          sel={sel}
          rootLabel={si.label}
          rootPath={rootPath}
          onSegmentClick={onSegmentClick}
          onFocus={onFocus}
        />
      </div>
      <div id="app-header-right" />
    </header>
  );
}

// ── Props-driven AppHeader (used by the backward-compat shim) ────────────────
// Kept so the shim below can pass explicit state without depending on signals.

interface _AppHeaderPropsLegacy {
  state: ReadonlySignal<AppHeaderState>;
  onSegmentClick?: ((path: string) => void) | null;
  onSwitchSource?: () => void;
  onResetView?: () => void;
  onFocus?: () => void;
}

function _AppHeaderLegacy({
  state,
  onSegmentClick,
  onSwitchSource,
  onResetView,
  onFocus,
}: _AppHeaderPropsLegacy) {
  const s = state.value;
  return (
    <>
      <HeaderLeft
        rootLabel={s.rootLabel}
        branch={s.branch}
        sourceUrl={s.sourceUrl}
        onResetView={onResetView}
        onSwitchSource={onSwitchSource}
      />
      <HeaderTitle
        sel={s.selection}
        rootLabel={s.rootLabel}
        rootPath={s.rootPath}
        onSegmentClick={onSegmentClick}
        onFocus={onFocus}
      />
    </>
  );
}

// ── Backward-compat shim ──────────────────────────────────────────────────────
// Phase 3e will delete this once App.tsx mounts <AppHeader /> directly.
//
// The shim mounts <HeaderLeft> into leftEl and <HeaderTitle> into titleEl
// (two separate Preact roots), matching the original DOM structure where
// these two slots are managed independently.

/**
 * Initialise the sitewide header.
 *
 * The path-badge subscribes to BUILDING_PALETTE + ASPHALT so changing an
 * extension hue or the asphalt color in Controls live-repaints the badge.
 */
export function initAppHeader(opts: InitAppHeaderOpts = {}) {
  const {
    rootLabel = '',
    rootPath = '',
    onSegmentClick = null,
    onSwitchSource,
    onResetView,
    onFocus,
  } = opts;

  const titleEl = document.getElementById('app-title');
  if (!titleEl) {
    return {
      setSelection(_sel: HeaderSelection | null) {},
      setSourceInfo(_rootLabel?: string, _branch?: string, _sourceUrl?: string) {},
    };
  }

  // Far-left controls live in this wrapper. Fall back to the header element
  // itself if the wrapper isn't present (older shells / test fixtures).
  const leftEl: HTMLElement = document.getElementById('app-header-left') ?? titleEl.parentElement!;

  // Idempotency guard: clear previously-injected controls so we don't
  // accumulate stacked copies on error-path re-init.
  leftEl.querySelectorAll('[data-app-header-injected]').forEach((el) => el.remove());

  const state = signal<AppHeaderState>({
    selection: null,
    rootLabel,
    rootPath,
    branch: opts.branch,
    sourceUrl: opts.sourceUrl,
  });

  // Mount HeaderLeft into leftEl
  render(
    <_AppHeaderLegacy
      state={state}
      onResetView={onResetView}
      onSwitchSource={onSwitchSource}
      onSegmentClick={onSegmentClick}
      onFocus={onFocus}
    />,
    leftEl
  );

  function _rerenderLeft(): void {
    render(
      <_AppHeaderLegacy
        state={state}
        onResetView={onResetView}
        onSwitchSource={onSwitchSource}
        onSegmentClick={onSegmentClick}
        onFocus={onFocus}
      />,
      leftEl
    );
  }

  function _rerenderTitle(): void {
    render(
      <HeaderTitle
        sel={state.value.selection}
        rootLabel={state.value.rootLabel}
        rootPath={state.value.rootPath}
        onSegmentClick={onSegmentClick}
        onFocus={onFocus}
      />,
      titleEl!
    );
  }

  function setSelection(sel: HeaderSelection | null): void {
    state.value = { ...state.value, selection: sel };
    _rerenderTitle();
  }

  function setSourceInfo(newRootLabel?: string, branch?: string, sourceUrl?: string): void {
    state.value = {
      ...state.value,
      ...(typeof newRootLabel === 'string' ? { rootLabel: newRootLabel } : {}),
      branch,
      sourceUrl,
    };
    _rerenderLeft();
    _rerenderTitle();
  }

  return {
    setSelection,
    setSourceInfo,
  };
}

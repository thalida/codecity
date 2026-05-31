// views/shell/header/HeaderTitle.tsx — The center "title slot" of AppHeader.
// Renders one of three shapes depending on the current selection:
//   - null selection (or root-only) → empty
//   - file/dir selection → extension badge + path breadcrumb + copy button
//   - commit selection → "Commit <sha> · <author>" with copy SHA button
//
// The breadcrumb owns a ResizeObserver that applies middle-ellipsis to fit
// the path into the available width as the header row resizes.

import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ASPHALT, BUILDING_PALETTE } from '@/state/settings';
import { LucideIcon } from '@/views/components/LucideIcon';
import { ExtensionBadge } from '@/views/components/Badge';
import { CopyButton } from '@/views/components/CopyButton';
import { applyMiddleEllipsis } from '@/utils/middleEllipsis';

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

export interface HeaderTitleProps {
  sel: HeaderSelection | null;
  rootLabel: string;
  rootPath: string;
  onSegmentClick?: ((path: string) => void) | null;
  onFocus?: () => void;
}

export function HeaderTitle({ sel, rootLabel, rootPath, onSegmentClick, onFocus }: HeaderTitleProps) {
  const crumbsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!crumbsRef.current) return;
    const crumbsEl = crumbsRef.current;
    const segEls = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-seg'));
    const sepEls = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-sep'));
    applyMiddleEllipsis(crumbsEl, segEls, sepEls, { ellipsisClass: 'app-header-ellipsis' });

    // Observe the header row for resize events
    const parentRow = crumbsEl.closest('header, [id]') as HTMLElement | null;
    if (!parentRow) return;
    const ro = new ResizeObserver(() => {
      const s = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-seg'));
      const sep = Array.from(crumbsEl.querySelectorAll<HTMLElement>('.app-header-sep'));
      applyMiddleEllipsis(crumbsEl, s, sep, { ellipsisClass: 'app-header-ellipsis' });
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
              {i > 0 && <span class="app-header-sep">›</span>}
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

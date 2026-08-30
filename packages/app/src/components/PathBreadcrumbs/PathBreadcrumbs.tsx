// components/PathBreadcrumbs/PathBreadcrumbs.tsx — the title slot for a selected node: a badge
// and a path truncated in the middle to fit the header, with the leaf
// emphasised. Segments are buttons only when there's something to do with one.

import { NodeKind } from '@codecity/city';
import './PathBreadcrumbs.css';
import { Fragment } from 'preact';
import { useContext } from 'preact/hooks';
import { KindBadge } from '@/features/city/components/KindBadge/KindBadge';
import { useMiddleEllipsis } from '@/hooks/useMiddleEllipsis';
import { PaneTitleBudgetContext } from '@/components/PaneHeader/PaneHeader';
import { buildPathCrumbs } from '@/components/PathBreadcrumbs/pathCrumbs';

export interface PathBreadcrumbsProps {
  /** Selected path relative to the project root. */
  path: string;
  /** File extension (for the badge hue); ignored for directories. */
  extension?: string;
  isDir?: boolean;
  rootLabel: string;
  rootPath: string;
  onSegmentClick?: ((path: string) => void) | null;
}

export function PathBreadcrumbs({
  path,
  extension,
  isDir,
  rootLabel,
  rootPath,
  onSegmentClick,
}: PathBreadcrumbsProps) {
  // Measured against the header's lead group: the title hugs its content, so
  // once truncation shrinks it the crumbs could never come back.
  const budgetRef = useContext(PaneTitleBudgetContext);
  const crumbsRef = useMiddleEllipsis<HTMLDivElement>(
    {
      segmentClass: 'crumb',
      separatorClass: 'crumb-sep',
      ellipsisClass: 'crumb-ellipsis',
      observeRef: budgetRef ?? undefined,
    },
    [path]
  );

  const isFileSel = !isDir;
  const { isRoot, crumbs } = buildPathCrumbs(path, { isDir, rootLabel, rootPath });

  return (
    <>
      <KindBadge
        kind={isFileSel ? NodeKind.File : NodeKind.Directory}
        extension={isFileSel ? extension : null}
      />
      <div ref={crumbsRef} class="crumbs" title={isRoot ? rootLabel : `${rootLabel}/${path}`}>
        {crumbs.map((crumb, i) => {
          const isLeaf = i === crumbs.length - 1;
          const leafClass = isLeaf ? ' is-leaf' : '';
          return (
            <Fragment key={`seg-${i}`}>
              {i > 0 && (
                <span class="crumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {onSegmentClick ? (
                <button
                  type="button"
                  class={`btn-icon btn-icon--text crumb${leafClass}`}
                  onClick={() => onSegmentClick(crumb.segPath)}
                >
                  {crumb.label}
                </button>
              ) : (
                // Display-only: a plain segment, not a faded disabled button.
                <span class={`crumb crumb--static${leafClass}`}>{crumb.label}</span>
              )}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

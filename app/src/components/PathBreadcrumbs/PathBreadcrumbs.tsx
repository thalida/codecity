// components/PathBreadcrumbs.tsx — Display-only header title slot for a selected
// file/dir: an extension badge + a middle-ellipsized path breadcrumb (leaf
// emphasized). The header's focus/copy/close buttons live in the pane header's
// right-hand action group, not here. The breadcrumb owns a ResizeObserver
// (useMiddleEllipsis) that middle-truncates the path to fit the header width.
// Segments are buttons only when onSegmentClick is given (else plain labels).

import './PathBreadcrumbs.css';
import { Fragment } from 'preact';
import { NodeKind } from '@/types';
import { KindBadge } from '@/components/Badge/Badge';
import { useMiddleEllipsis } from '@/hooks/useMiddleEllipsis';
import { buildPathCrumbs } from '@/utils/pathCrumbs';

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
  const crumbsRef = useMiddleEllipsis<HTMLDivElement>(
    {
      segmentClass: 'app-header-seg',
      separatorClass: 'app-header-sep',
      ellipsisClass: 'app-header-ellipsis',
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
      <div
        ref={crumbsRef}
        class="app-header-crumbs"
        title={isRoot ? rootLabel : `${rootLabel}/${path}`}
      >
        {crumbs.map((crumb, i) => {
          const isLeaf = i === crumbs.length - 1;
          const leafClass = isLeaf ? ' is-leaf' : '';
          return (
            <Fragment key={`seg-${i}`}>
              {i > 0 && (
                <span class="app-header-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {onSegmentClick ? (
                <button
                  type="button"
                  class={`btn-icon btn-icon--text app-header-seg${leafClass}`}
                  onClick={() => onSegmentClick(crumb.segPath)}
                >
                  {crumb.label}
                </button>
              ) : (
                // Display-only: a plain segment, not a faded disabled button.
                <span class={`app-header-seg app-header-seg--static${leafClass}`}>
                  {crumb.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

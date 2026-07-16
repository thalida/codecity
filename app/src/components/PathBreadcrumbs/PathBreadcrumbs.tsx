// components/PathBreadcrumbs.tsx — Header title slot for a selected
// file/dir: a focus button + extension badge + clickable path breadcrumb +
// copy-path button. The breadcrumb owns a ResizeObserver (useMiddleEllipsis)
// that middle-truncates the path to fit the header width.

import './PathBreadcrumbs.css';
import { Fragment } from 'preact';
import { Focus } from 'lucide-preact';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { ExtensionBadge } from '@/components/Badge/Badge';
import { CopyButton } from '@/components/CopyButton/CopyButton';
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
  onFocus?: () => void;
}

export function PathBreadcrumbs({
  path,
  extension,
  isDir,
  rootLabel,
  rootPath,
  onSegmentClick,
  onFocus,
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
  const focusTitle = `Focus camera on selection (${KEY_BINDINGS.FOCUS_SELECTION.label})`;

  return (
    <>
      {onFocus && (
        <button
          type="button"
          class="btn-icon btn-icon--no-drag"
          title={focusTitle}
          aria-label={focusTitle}
          onClick={() => onFocus()}
        >
          <Focus class="icon" />
        </button>
      )}
      <ExtensionBadge extension={isFileSel ? (extension ?? null) : null} isDir={!isFileSel} />
      <div
        ref={crumbsRef}
        class="app-header-crumbs"
        title={isRoot ? rootLabel : `${rootLabel}/${path}`}
      >
        {crumbs.map((crumb, i) => {
          const isLeaf = i === crumbs.length - 1;
          return (
            <Fragment key={`seg-${i}`}>
              {i > 0 && (
                <span class="app-header-sep" aria-hidden="true">
                  ›
                </span>
              )}
              <button
                type="button"
                class={`btn-icon btn-icon--text btn-icon--no-drag app-header-seg${isLeaf ? ' is-leaf' : ''}`}
                onClick={() => {
                  if (onSegmentClick) onSegmentClick(crumb.segPath);
                }}
              >
                {crumb.label}
              </button>
            </Fragment>
          );
        })}
      </div>
      <CopyButton text={isRoot ? rootPath : path} />
    </>
  );
}

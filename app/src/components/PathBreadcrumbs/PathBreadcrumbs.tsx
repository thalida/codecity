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
  // The root directory has no relative path to walk — show the repo label as a
  // single crumb (clicking re-selects root) instead of a bare "." segment.
  const isRoot = isDir && (path === rootPath || path === '.');
  const crumbs: { label: string; segPath: string }[] = isRoot
    ? [{ label: rootLabel, segPath: rootPath }]
    : path
        .split('/')
        .filter(Boolean)
        .map((seg, i, all) => ({ label: seg, segPath: all.slice(0, i + 1).join('/') }));
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
          <Focus class="lucide-icon" />
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
              {i > 0 && <span class="app-header-sep">›</span>}
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

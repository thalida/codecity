// views/shell/header/HeaderLeft.tsx — Left cluster of AppHeader.
// Renders the reset-view (gem) button, the project chip (icon + label +
// optional @branch pill + chevron), and the external repo link icon
// when the loaded source is a git URL.
//
// All three pieces are simple JSX — no internal state — so they stay
// as a single component rather than split further.

import { LucideIcon } from '@/views/components/LucideIcon';
import { GemIcon } from '@/views/components/GemIcon';
import { toHttpsRepoUrl } from '@/utils/sources';

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

export interface HeaderLeftProps {
  rootLabel: string;
  branch: string | undefined;
  sourceUrl: string | undefined;
  onResetView?: () => void;
  onSwitchSource?: () => void;
}

export function HeaderLeft({ rootLabel, branch, sourceUrl, onResetView, onSwitchSource }: HeaderLeftProps) {
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
        >
          <LucideIcon name="external-link" />
        </a>
      )}
    </>
  );
}

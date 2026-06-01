// layout/header/RepoLink.tsx — External-link icon that opens the loaded git
// repo (at the current branch) in a new tab. Renders nothing for local sources.

import { ExternalLink } from 'lucide-preact';
import { toHttpsRepoUrl } from '@/utils/sources';

/**
 * Append a branch-tree path to a forge HTTPS URL so the link opens the branch
 * instead of the repo root.
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

export interface RepoLinkProps {
  sourceUrl: string | undefined;
  branch: string | undefined;
}

export function RepoLink({ sourceUrl, branch }: RepoLinkProps) {
  if (!sourceUrl) return null;
  const href = branch ? _withBranchPath(toHttpsRepoUrl(sourceUrl), branch) : toHttpsRepoUrl(sourceUrl);
  const title = branch ? `Open repo at @${branch}` : `Open repo: ${sourceUrl}`;
  return (
    <a
      class="btn-icon btn-icon--link btn-icon--no-drag"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open repository in a new tab"
      title={title}
    >
      <ExternalLink class="lucide-icon" />
    </a>
  );
}

// components/RepoLink.tsx — External-link icon that opens the loaded git
// repo (at the current branch) in a new tab. Renders nothing for local sources.

import { ExternalLink } from 'lucide-preact';
import { toHttpsRepoUrl, repoUrlForBranch } from '@/utils/sources';

export interface RepoLinkProps {
  sourceUrl: string | undefined;
  branch: string | undefined;
}

export function RepoLink({ sourceUrl, branch }: RepoLinkProps) {
  if (!sourceUrl) return null;
  const repoUrl = toHttpsRepoUrl(sourceUrl);
  const href = branch ? repoUrlForBranch(repoUrl, branch) : repoUrl;
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

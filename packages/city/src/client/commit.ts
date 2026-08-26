// client/commit.ts — lazy fetcher for the full commit
// message body. Called when the user clicks "Show full message" in
// the commit pane. Author + subject are already in the manifest;
// body comes from /api/commit on demand to keep the manifest small.

import type { SourceRef } from '@/types';
import type { ApiUrl } from './url';

export interface CommitDetail {
  sha: string;
  authors: string[];
  date: string;
  subject: string;
  body: string;
}

export function createCommitEndpoints(apiUrl: ApiUrl) {
  async function fetchCommitDetail(source: SourceRef, sha: string): Promise<CommitDetail> {
    const resp = await fetch(
      apiUrl('commit', { src: source.src, branch: source.branch ?? undefined, sha })
    );
    if (!resp.ok) {
      throw new Error(`commit fetch failed: ${resp.status}`);
    }
    return (await resp.json()) as CommitDetail;
  }

  return {
    fetchCommitDetail,
  };
}

// api/branches.ts — Client for GET /api/branches. Fetches the remote branch
// list for a git URL so the picker can offer a valid-for-this-repo dropdown
// instead of a free-text field. Remote URLs only (local sources have no branch).

import { URL_PARAMS } from '@/constants/urlParams';

export interface BranchList {
  branches: string[];
  default: string | null;
}

export async function fetchBranches(src: string): Promise<BranchList> {
  const url = new URL('/api/branches', window.location.origin);
  url.searchParams.set(URL_PARAMS.SRC, src);
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    let message = `branch lookup failed (${resp.status})`;
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body?.detail) message = body.detail;
    } catch (_) {
      /* non-JSON error body: keep the status-based message */
    }
    throw new Error(message);
  }
  const body = (await resp.json()) as BranchList;
  return { branches: body.branches ?? [], default: body.default ?? null };
}

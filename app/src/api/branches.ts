// api/branches.ts — Client for GET /api/branches. Fetches the remote branch
// list for a git URL so the picker can offer a valid-for-this-repo dropdown
// instead of a free-text field. Remote URLs only (local sources have no branch).

import { URL_PARAMS } from '@/constants/urlParams';
import { apiUrl } from '@/api/apiUrl';
import { ScanError, type ScanErrorCode } from '@/api/manifest';

export interface BranchList {
  branches: string[];
  default: string | null;
}

// Editing a URL re-resolves it, and backspacing a character asks the same
// question again. Each miss is the server reaching the remote, so keep answers.
const _byUrl = new Map<string, Promise<BranchList>>();

/** The remote's branch list, resolved once per URL for this page. */
export function fetchBranches(src: string): Promise<BranchList> {
  const hit = _byUrl.get(src);
  if (hit) return hit;
  // Only successes stick: a cached refusal would outlive the outage behind it.
  const pending = _fetchBranches(src).catch((e: unknown) => {
    _byUrl.delete(src);
    throw e;
  });
  _byUrl.set(src, pending);
  return pending;
}

/** Test-only: drop the per-URL memo so successive tests can answer differently. */
export function _resetBranchCacheForTests(): void {
  _byUrl.clear();
}

async function _fetchBranches(src: string): Promise<BranchList> {
  const resp = await fetch(apiUrl('branches', { [URL_PARAMS.SRC]: src }));
  if (!resp.ok) {
    let message = `branch lookup failed (${resp.status})`;
    let code: ScanErrorCode | undefined;
    try {
      // The API's error envelope is { error, code? }; fall back to FastAPI's
      // { detail } for anything that bypasses the app's handler.
      const body = (await resp.json()) as {
        error?: string;
        code?: ScanErrorCode;
        detail?: string;
      };
      if (body?.error) message = body.error;
      else if (body?.detail) message = body.detail;
      code = body?.code;
    } catch (_) {
      /* non-JSON error body: keep the status-based message */
    }
    // Same carrier the manifest stream uses, so a caller keys its remedy on the
    // code whichever request surfaced the failure.
    throw new ScanError(message, code);
  }
  const body = (await resp.json()) as BranchList;
  return { branches: body.branches ?? [], default: body.default ?? null };
}

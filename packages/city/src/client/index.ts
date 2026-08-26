// client/index.ts — the one place in the repo that talks to the codecity api.
//
// `createClient({ baseUrl })` binds every endpoint to one base and hands them
// back flat. The city uses it to fetch its own repo; the app constructs one for
// the four endpoints the city never calls itself (branches, discover, config,
// commit). One package talks HTTP, so a retry policy, an auth header or a fetch
// timeout later lands in one place instead of two.

import { createApiUrl } from './url';
import { createBranchesEndpoints } from './branches';
import { createCommitEndpoints } from './commit';
import { createConfigEndpoints } from './config';
import { createDiscoverEndpoints } from './discover';
import { createFileEndpoints } from './file';
import { createFingerprintEndpoints } from './fingerprint';
import { createManifestEndpoints } from './manifest';
import { createTimelineEndpoints } from './timeline';

export interface ClientOptions {
  /** A PATH (`/api`, or a subpath under a deploy base), never an origin —
   *  same-origin only, see url.ts. */
  baseUrl: string;
}

export function createClient({ baseUrl }: ClientOptions) {
  const apiUrl = createApiUrl(baseUrl);
  const file = createFileEndpoints(apiUrl);
  return {
    apiUrl,
    ...createManifestEndpoints(apiUrl),
    ...file,
    // A fingerprint is fetched through the same content path as a file, so it
    // inherits ContentPendingError for a blob the server has not downloaded yet.
    ...createFingerprintEndpoints(apiUrl, file.fetchContent),
    ...createTimelineEndpoints(apiUrl),
    ...createBranchesEndpoints(apiUrl),
    ...createDiscoverEndpoints(apiUrl),
    ...createConfigEndpoints(apiUrl),
    ...createCommitEndpoints(apiUrl),
  };
}

export type CodecityClient = ReturnType<typeof createClient>;

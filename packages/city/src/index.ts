// @codecity/city — public surface.
//
// createCity and the 3D scene land here over the course of #208. What is here
// today: the api client (every call to the codecity backend goes through it,
// including the four endpoints the city never makes itself) and the types it
// produces — the wire format, and the geometry the layout builds from it.

export { createClient, type ClientOptions, type CodecityClient } from './client/index';
export type { ApiUrl } from './client/url';
export { URL_PARAMS } from './client/urlParams';

export { ScanError, ScanPhase, CloneStage } from './client/manifest';
export type {
  ScanStreamEvent,
  ScanErrorCode,
  ScanProgressEvent,
  SignatureResponse,
} from './client/manifest';
export { ContentPendingError } from './client/file';
export type { BranchList } from './client/branches';
export type { CommitDetail } from './client/commit';
export { DEFAULT_SERVER_CONFIG, type ServerConfig } from './client/config';
export type { DiscoverEntry } from './client/discover';

// ── Types ────────────────────────────────────────────────────────────────
// The wire format the backend defines, and the geometry the layout produces
// from it. The app keeps only its own overlay and panel shapes (types/ui.ts,
// types/controls.ts).
export * from './types/manifest';
export * from './types/timeline';
export * from './types/building';
export * from './types/street';
export * from './types/scene';
export * from './types/animation';
export type { components, paths, operations } from './types/manifest.generated';

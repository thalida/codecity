// @codecity/city — public surface.
//
// createCity and the 3D scene land here over the course of #208. What is here
// today is the api client: every call to the codecity backend goes through it,
// including the four endpoints the city never makes itself.

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

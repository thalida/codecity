// @codecity/city — public surface.
//
// createCity and everything that produces the scene: the renderer, the api
// client every backend call goes through, the types it produces, and the
// settings schema that says what is tunable.

export { createCity } from './createCity';
export type { City, SceneComponent, SceneContext, FrameContext } from './types';

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

// ── Utilities and constants the layout builds from ───────────────────────
// The app imports these back: a badge and a building have to agree on what
// kind a file is, and on which day a commit landed.
export * from './utils/fileKind';
export * from './utils/fileIcons';
export * from './utils/manifest';
export * from './utils/dates';
export * from './constants/fileExtensions';
export * from './constants/fileIconMap';
export * from './constants/materialIcons';
export * from './constants/buildings';
export * from './constants/gem';
export * from './constants/manifest';

// ── Settings schema ──────────────────────────────────────────────────────
// The city declares what is tunable, what each field's bounds are, and what
// changing it costs (ChangeRoute). Values, persistence and any signals the
// consumer binds to are the consumer's — the package never holds them.
export * from './settings/schema';
export * from './types/picker';
export * from './settings/fields/buildings';
export * from './settings/fields/camera';
export * from './settings/fields/effects';
export * from './settings/fields/fireflies';
export * from './settings/fields/footprint';
export * from './settings/fields/gem';
export * from './settings/fields/island';
export * from './settings/fields/ruins';
export * from './settings/fields/scene';
export * from './settings/fields/scrubber';
export * from './settings/fields/streets';
export * from './settings/fields/trees';

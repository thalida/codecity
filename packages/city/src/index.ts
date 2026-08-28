// @codecity/city — public surface.
//
// createCity and everything that produces the scene: the renderer, the api
// client every backend call goes through, the types it produces, and the
// settings schema that says what is tunable.

export { createCity } from './createCity';
export type { City, FocusRef, SceneComponent, SceneContext, FrameContext } from './types';
export { BuildStage } from './types/build';

// ── Sources ──────────────────────────────────────────────────────────────
// What a source string is: cloned or on disk, which branch it means, whether
// two of them are the same repo. A host asks rather than deciding for itself,
// or it answers "same repo?" differently from the city it is driving.
export {
  SourceKind,
  srcKind,
  resolveBranch,
  identityBranch,
  sourceIdentity,
  sameSourceIdentity,
  sourceKey,
  looksResolvable,
  looksLikePath,
  validateGitUrl,
} from './source';

// ── What a city is doing ─────────────────────────────────────────────────
// One value, folded from the eleven events below it. A readout binds to this;
// the events are the detail behind it.
export { CityLifecycle, CityPhase, EMPTY_CITY_STATUS } from './status';
export type { CityStatus, CityStatusCounts, CityStatusTracker } from './status';

// ── Timeline ─────────────────────────────────────────────────────────────
// A city's history and where in it you are. The consumer needs the state's
// type to read the one its city hands back, and createTimelineState to answer
// before a canvas exists; the replay is what turns a bundle into per-path
// presence, which is how a file tree greys out what is not there yet.
export { createTimelineState } from './timeline/state';
export type { TimelineState, TimelineChange, ScrubbedFileStats } from './timeline/state';
export {
  buildPathTimelines,
  ruinStateAt,
  entryAt,
  lastModifiedIndexAt,
  PathState,
} from './timeline/replay';
export type { PathTimeline } from './timeline/replay';

// ── Driving the camera ───────────────────────────────────────────────────
// Which of the two ways a go-to command points the camera.
export { FocusMode } from './render/cameraRig';

// ── Keyboard ─────────────────────────────────────────────────────────────
// The bindings the canvas listens for, so a consumer's own shortcut list can
// show them rather than restating them and drifting.
export { CITY_KEY_BINDINGS, TEXT_INPUT_TAGS } from './constants/keyboard';
export type { KeyBinding } from './constants/keyboard';

// A frame the browser has actually painted: the city uses it to let a readout
// show before a long synchronous build freezes the page.
export { nextPaint } from './utils/nextPaint';

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
// A file's colour and an author's, both derived rather than stored: a badge in
// a list and the building it names have to agree.
export { getHue, extHueColor } from './components/buildings/color';
export { colorForAuthor } from './components/fireflies/authorColor';

// ── Settings schema ──────────────────────────────────────────────────────
// The city declares what is tunable, what each field's bounds are, and what
// changing it costs (ChangeRoute). Values, persistence and any signals the
// consumer binds to are the consumer's — the package never holds them.
export * from './settings/schema';
// The whole settings shape: what a city can be told, and the stock answer.
export {
  CITY_FIELDS,
  defaultCitySettings,
  mergeCitySettings,
  type CitySettings,
  type CitySettingsPatch,
  type CityStore,
} from './settings';
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

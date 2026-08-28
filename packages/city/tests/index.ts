// @codecity/city/testing — the kit for testing against a city.
//
// A consumer that renders a city has to build one, feed it a manifest and
// assert on what came back, and every piece of that is package-shaped: the wire
// fixtures, a settings store, a WebGL renderer jsdom can run, a picker stub.
// Defining them here means there is one EMPTY_MANIFEST rather than one per
// consumer, drifting.
//
// Not shipped for production use and not covered by semver — it is a test
// dependency, and it moves with the tests.

export { EMPTY_MANIFEST, EMPTY_REPO_STATS, TEST_SOURCE } from './_helpers/manifestFixtures';
export { commits, commitSeries } from './_helpers/commits';
export { fileStats, fileLeader, commitStats, uniformFileStats } from './_helpers/statsFixtures';
export {
  LINE_STATS,
  BYTE_STATS,
  SUBJECT_BUNDLE,
  PRESENCE_BUNDLE,
  makeScrubFrame,
  makeBundle,
  makeCommitBundle,
  makeScrubInput,
  scrubSubject,
} from './_helpers/scrub';

export { citySettings, settingsStore, layoutCfg, treeCfg } from './_helpers/citySettings';
export { createTestCityResources } from './_helpers/cityResources';
export { createEmitter, recordingEmitter, nextBuild } from './_helpers/cityEvents';
export type { RecordedEvent } from './_helpers/cityEvents';
export {
  stubPlacementClient,
  makeCityState,
  makeSceneContext,
  makePickableSceneContext,
  emptyLayout,
  mkFile,
  mkDir,
  treePlacement,
  commitTarget,
  republishCity,
  drivableCityState,
  fakePicker,
} from './_helpers/cityFixtures';
export type { DrivableCityState, FakePicker } from './_helpers/cityFixtures';

// jsdom has no EventSource.
export { StubEventSource, makeES, installEventSource } from './_helpers/eventSource';

// It has no WebGL either, but the renderer stubs are NOT re-exported here.
// A `vi.mock('three')` factory has to await whatever module holds them, and
// this one reaches the city's source, which imports three — the module being
// mocked. They get their own door: `@codecity/city/testing/three`.

// state/stores/progress.ts — what the overlay above the scene city shows.
//
// The city answers "what is happening, how far along, is this the finished
// city" itself, as one value: see CITY_STATUS below. What is left here is the
// app's own: which rows THIS overlay lists, how they read, and the fact that a
// source was asked for before the city had anything to say about it.

import type { City, CityStatus } from '@codecity/city';
import { CityLifecycle, CityPhase, EMPTY_CITY_STATUS } from '@codecity/city';
import { signal, effect } from '@preact/signals';
import { SourceKind } from '@codecity/city';
import {
  LoadingStep,
  LOADING_STEPS,
  firstStepFor,
  countsTail,
  buildStageTail,
} from '@/constants/progress';
import { MANIFEST, type ManifestValue } from './manifest';
import type { LoadingOverlayShowOpts, LoadingOverlayState } from '@/types/ui';

// ── What the scene city is doing ─────────────────────────────────────

/** The scene city's own status, mirrored onto a signal so the view layer can
 *  render off it. Empty before a city is mounted. attachCityStatus keeps it. */
export const CITY_STATUS = signal<CityStatus>(EMPTY_CITY_STATUS);

/** What THIS app asked for, which it knows before the city reports anything:
 *  a local path skips the rows a remote source runs, and the branch is in the
 *  header. Non-null while a load this app started is in flight. */
export interface LoadingSource {
  kind: SourceKind;
  branch?: string;
}

export const LOADING_SOURCE = signal<LoadingSource | null>(null);

/** Mirror one city's status onto CITY_STATUS. The SCENE city's only: the
 *  landing's wallpaper builds behind the page and must not move a readout that
 *  belongs to the project being read. Returns the unsubscribe. */
export function attachCityStatus(city: Pick<City, 'status' | 'onStatus'>): () => void {
  CITY_STATUS.value = city.status;
  return city.onStatus((status) => {
    CITY_STATUS.value = status;
  });
}

// ── What the app adds to it ─────────────────────────────────────────
// Two facts the city has no event for, because neither is about the city: a
// Save it answers by refreshing materials in place (nothing rebuilds, so
// nothing is reported), and when the last finished build landed in wall time.

/** Work THIS app is doing that no city is reporting, and failures of it. Three
 *  cases, all genuinely the host's: a Save the city answers by refreshing
 *  materials in place (nothing rebuilds, so nothing is reported), a re-scan it
 *  has decided on but not yet asked for, and the timeline bundle it fetches
 *  itself before handing a city anything.
 *
 *  Deliberately one shape and one signal. The five-state machine this replaces
 *  was a second account of what the city already says. */
export interface HostWork {
  busy: boolean;
  error: unknown | null;
}

export const HOST_WORK = signal<HostWork>({ busy: false, error: null });

export function beginHostWork(): void {
  HOST_WORK.value = { busy: true, error: null };
}

export function endHostWork(): void {
  if (!HOST_WORK.peek().busy) return;
  HOST_WORK.value = { busy: false, error: null };
  LAST_UPDATED_AT.value = Date.now();
}

export function failHostWork(error: unknown): void {
  // Logged with the stack, where a developer can use it. The UI shows a generic
  // line: the message names our internals, and a reader cannot act on it.
  console.error('[codecity] the app could not finish what it started', error);
  HOST_WORK.value = { busy: false, error };
  REBUILD_DETAIL.value = null;
}

/** Epoch millis of the most recent finished build. The city says it is Ready;
 *  how long ago that was is the reader's question, not the city's. */
export const LAST_UPDATED_AT = signal<number>(0);

/** How far along a rebuild that has no overlay above it (Timeline refetching a
 *  bundle under an exclude edit) — the one build nothing else reports. */
export const REBUILD_DETAIL = signal<string | null>(null);

export function setRebuildDetail(detail: string | null): void {
  REBUILD_DETAIL.value = detail;
}

/** The manifest the FINISHED city was built from. A consumer that aims the
 *  camera at a node needs that node to exist. */
export const BUILT_MANIFEST = signal<ManifestValue>(null);

// ── What the overlay shows ───────────────────────────────────────────

/** Repo name in the loading overlay's header, shown before the manifest lands.
 *  Overlay-owned: showLoadingOverlay/hideLoadingOverlay control its lifetime. */
export const PENDING_SOURCE_LABEL = signal<string | null>(null);

export const LOADING_OVERLAY = signal<LoadingOverlayState>({
  visible: false,
  showOpts: null,
  activeStep: null,
  stepTails: {},
});

// A load that can be backed out of registers its own abort; null falls back to
// the App default.
export const LOADING_CANCEL = signal<(() => void) | null>(null);

// peek, not value: these are called from inside other effects, and tracking the
// prior state would subscribe an effect to a signal it goes on to write.

// Omitting onCancel leaves any registered handler in place, so a caller can
// pre-register one before the reaction shows the overlay.
export function showLoadingOverlay(
  opts: LoadingOverlayShowOpts,
  onCancel?: (() => void) | null
): void {
  LOADING_OVERLAY.value = {
    visible: true,
    showOpts: opts,
    activeStep: firstStepFor(opts.steps ?? LOADING_STEPS, opts.kind),
    stepTails: {},
  };
  if (onCancel !== undefined) LOADING_CANCEL.value = onCancel;
}

export function setLoadingCancel(onCancel: (() => void) | null): void {
  LOADING_CANCEL.value = onCancel;
}

export function hideLoadingOverlay(): void {
  LOADING_OVERLAY.value = { ...LOADING_OVERLAY.peek(), visible: false };
  LOADING_CANCEL.value = null;
  // The header belongs to the overlay, so it clears here rather than at each
  // call site: one that forgets leaves a stale label over the next load.
  PENDING_SOURCE_LABEL.value = null;
}

export function setLoadingStep(step: LoadingStep): void {
  const prev = LOADING_OVERLAY.peek();
  if (prev.activeStep === step) return;
  LOADING_OVERLAY.value = { ...prev, activeStep: step };
}

export function setLoadingStepTail(step: LoadingStep, tail: string | null): void {
  const prev = LOADING_OVERLAY.peek();
  LOADING_OVERLAY.value = {
    ...prev,
    stepTails: { ...prev.stepTails, [step]: tail },
  };
}

// ── The Live driver ──────────────────────────────────────────────────

export function attachOverlayDriver(): () => void {
  return attachCityStatusReaction();
}

// The overlay's rows, driven by the one status the city reports. What this
// reduces is presentation only — which rows this app lists, and how far down
// them the load has got. What is HAPPENING is not derived here any more.
function attachCityStatusReaction(): () => void {
  let overlayUp = false;
  // How far down the list this load has got. A row that lights up again after a
  // later one reads as the whole load starting over.
  let reached = -1;
  const advance = (step: LoadingStep): void => {
    if (!overlayUp) return;
    const index = LOADING_STEPS.indexOf(step);
    if (index <= reached) return;
    reached = index;
    setLoadingStep(step);
  };

  return effect(() => {
    const status = CITY_STATUS.value;
    const asked = LOADING_SOURCE.value;
    const hide = () => {
      if (overlayUp) hideLoadingOverlay();
      overlayUp = false;
    };

    // Nothing is coming and there is nothing left to wait for. `fetching` is
    // the whole of the second half: a city can be on screen and still not be
    // the finished one, which is what grew trees after the overlay went.
    if (!asked && !status.fetching && status.lifecycle !== CityLifecycle.Loading) {
      hide();
      return;
    }

    if (!overlayUp && asked) {
      // The load was asked for before the city had anything to say: open on the
      // first row this source kind actually runs.
      showLoadingOverlay({ kind: asked.kind, branch: asked.branch });
      overlayUp = true;
      reached = LOADING_STEPS.indexOf(firstStepFor(LOADING_STEPS, asked.kind));
    }

    // The phase IS the row. Null with a source asked for is a load the city has
    // not reported on yet: open on the first row this kind actually runs.
    const step = status.phase ?? (asked ? firstStepFor(LOADING_STEPS, asked.kind) : null);
    if (step) advance(step);
    // The counts belong to the row that is producing them, and clear when it
    // hands over: a stale "1,204 files" beside "Building city" reads as a
    // scanner that is still running.
    setLoadingStepTail(
      LoadingStep.Cloning,
      step === LoadingStep.Cloning ? countsTail(status) : null
    );
    setLoadingStepTail(
      LoadingStep.Scanning,
      step === LoadingStep.Scanning ? countsTail(status) : null
    );
    setLoadingStepTail(
      LoadingStep.Building,
      step === CityPhase.Building ? buildStageTail(status) : null
    );
  });
}

// ── Where a build's own reports come in ──────────────────────────────

/** Keep the app's own two facts in step with one city's status: what the
 *  finished city was built from, and when it finished. The SCENE city's only —
 *  a wallpaper's build is not this readout's business. Returns the unsubscribe.
 */
export function attachBuildProgress(city: Pick<City, 'status' | 'onStatus'>): () => void {
  let wasReady = city.status.lifecycle === CityLifecycle.Ready;
  return city.onStatus((status) => {
    const ready = status.lifecycle === CityLifecycle.Ready;
    if (ready && !wasReady) {
      BUILT_MANIFEST.value = MANIFEST.peek();
      LAST_UPDATED_AT.value = Date.now();
      REBUILD_DETAIL.value = null;
    }
    wasReady = ready;
    if (status.lifecycle === CityLifecycle.Error) {
      // Logged with the stack, where a developer can use it. The UI shows a
      // generic line: the message names our internals, and a reader cannot act
      // on it.
      console.error('[codecity] city build failed', status.error);
      REBUILD_DETAIL.value = null;
    }
  });
}

// types/ui.ts — the shapes the UI shell and its panes render against, and the
// discriminants that pick between them.

import type { SourceKind } from '@/utils/sources';
import type { LoadingStep } from '@/constants/loadingSteps';
import type { ScanErrorCode } from '@/api/manifest';

/** Left-sidebar tab IDs. Discriminator on the activity bar's mounted pane. */
export enum SidebarTab {
  Explore = 'explore',
  Search = 'search',
  Info = 'info',
  Controls = 'controls',
}

/** What the source picker submits when the user opens a project. */
export interface SourcePayload {
  src: string;
  branch?: string;
  /** When true, this open forces a fresh scan (server-side ?no_cache=1).
   *  Not persisted — re-opening from a recent uses cached scan by default. */
  skipCache?: boolean;
}

/** A load that failed: what went wrong, and what was being opened. The landing
 *  reads it to explain itself and to refill the form. */
export interface SourceError {
  error: string;
  /** The failure's machine-readable reason, where the server gave one, so the
   *  form can offer a remedy instead of only echoing the message. */
  code?: ScanErrorCode;
  prefill?: SourcePayload;
}

/** Options for showing the loading overlay. */
export interface LoadingOverlayShowOpts {
  kind: SourceKind;
  branch?: string;
  /** Custom step list (e.g. Timeline-mode entry). Defaults to LOADING_STEPS. */
  steps?: readonly LoadingStep[];
}

export interface LoadingOverlayState {
  visible: boolean;
  showOpts: LoadingOverlayShowOpts | null;
  activeStep: LoadingStep | null;
  stepTails: Partial<Record<LoadingStep, string | null>>;
}

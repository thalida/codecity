// types/ui.ts — the shapes the UI shell and its panes render against, and the
// discriminants that pick between them.

import { ScanErrorCode } from '@codecity/city';
import type { SourceKind } from '@codecity/city';
import type { LoadingStep } from '@/constants/progress';

/** Left-sidebar tab IDs. Discriminator on the activity bar's mounted pane. */
export enum SidebarTab {
  Explore = 'explore',
  Search = 'search',
  Info = 'info',
  Controls = 'controls',
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

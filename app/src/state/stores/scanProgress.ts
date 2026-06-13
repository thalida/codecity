// state/stores/scanProgress.ts — Canonical streaming-progress signal written by
// the fetch layer (useManifestSource) while a source loads. The loading overlay
// is a REACTION to this (state/loadingReactions.ts) — the fetch layer no longer
// pokes LOADING_OVERLAY directly.

import { signal } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import { ScanPhase } from '@/api/manifest';

export interface ScanProgress {
  /** Kind of source being loaded (drives the overlay's initial step). */
  kind: SourceKind;
  /** Friendly label of the project being loaded. */
  label: string;
  branch?: string;
  /** Latest stream phase, or null when the load just started and no stream
   *  event has arrived yet (overlay shows the kind-based initial step). */
  phase: ScanPhase | null;
  /** Cloning percent (0-100) when phase === Cloning. */
  percent?: number;
  /** Cloning stage label (e.g. "receiving", "updating") when present. */
  stage?: string;
  /** Working-tree size on disk (MB) during the silent promisor blob fetch —
   *  a clone-progress heartbeat with no stage/percent. */
  mbOnDisk?: number;
  /** Files scanned so far when phase === Scanning. */
  filesScanned?: number;
}

/** Non-null while a source is actively loading; null when idle/done. */
export const SCAN_PROGRESS = signal<ScanProgress | null>(null);

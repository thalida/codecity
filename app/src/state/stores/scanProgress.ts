// state/stores/scanProgress.ts — what the SERVER is doing right now: clone
// percent, files scanned, which phase. The fetch layer is its only writer.
// The scene's own progress is stores/build; what the overlay shows is
// stores/loadingOverlay, which loadingReactions derives from both.

import { signal } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import { ScanPhase, CloneStage } from '@/api/manifest';
import type { Manifest } from '@/types';

export interface ScanProgress {
  /** Kind of source being loaded (drives the overlay's initial step). */
  kind: SourceKind;
  branch?: string;
  /** Latest stream phase, or null when the load just started and no stream
   *  event has arrived yet (overlay shows the kind-based initial step). */
  phase: ScanPhase | null;
  /** Cloning percent (0-100) when phase === Cloning. */
  percent?: number;
  /** Cloning stage (e.g. Receiving, Updating) when present. */
  stage?: CloneStage;
  /** Working-tree size on disk (MB) during the silent promisor blob fetch —
   *  a clone-progress heartbeat with no stage/percent. */
  mbOnDisk?: number;
  /** Git's own counts for the clone, where its line carried them. */
  objects?: number;
  objectsTotal?: number;
  mib?: number;
  /** Files scanned so far when phase === Scanning. */
  filesScanned?: number;
  /** `pending` of the manifest most recently APPLIED this load. Absent until
   *  its first manifest event, so a previous repo's can't leak in. */
  appliedPending?: Manifest['pending'];
}

/** Non-null while a source is actively loading; null when idle/done. */
export const SCAN_PROGRESS = signal<ScanProgress | null>(null);

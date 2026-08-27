// city/layout/protocol.ts — the layout-worker message contract. The single
// source for LayoutRequest + LayoutResponse, imported by both sides (worker.ts
// posts/receives them; index.ts builds the request + narrows the response) so
// the two ends can never drift. Mirrors components/trees/treePlacementProtocol.ts.

import type { LayoutConfig } from './config';
import type { Manifest } from '@/city/types/manifest';
import type { CityLayout } from '@/city/types/scene';

/** The only slice the worker needs. Sending the whole Manifest structured-
 *  clones its commits array across postMessage every apply, for nothing. */
export type LayoutManifest = Pick<Manifest, 'tree' | 'stats'>;

export interface LayoutRequest {
  type: 'layout';
  id: number;
  manifest: LayoutManifest;
  /** The sending city's own values, carried across unchanged — the worker
   *  reads them as-is rather than rebuilding stores of its own. */
  config: LayoutConfig;
}

export type LayoutResponse =
  | { type: 'layout-result'; id: number; layout: CityLayout }
  | { type: 'layout-error'; id: number; message: string }
  // Sent mid-pack, at most once per whole percent (see createPackReporter):
  // the longest stretch of a build, and the only one that can measure itself.
  | { type: 'layout-progress'; id: number; percent: number };

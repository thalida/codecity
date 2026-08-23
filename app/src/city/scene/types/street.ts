// types/street.ts — pairs with state/stores/settings/streets.ts (the tunables).
// Defines the Street shape the layout step produces.

import type { DirNode } from '@/types';

/** Street long-axis. 'x' = runs along world-X, 'y' = along world-Z. */
export enum StreetAxis {
  X = 'x',
  Y = 'y',
}

/** Which end(s) of a street's centerline get a rounded cap. Both is the root;
 *  a child rounds only its closed end. */
export enum CapStyle {
  Both = 'both',
  Low = 'low',
  High = 'high',
}

/** Which end meets the parent T. The open end is where this street merges
 *  into the parent's asphalt, so that cap stays off. */
export enum JoinSide {
  Low = 'low',
  High = 'high',
}

/** One street in the laid-out city: x/y center it, width is across (sidewalks
 *  included), length runs along `orientation`. */
export interface Street {
  x: number;
  y: number;
  width: number;
  length: number;
  label: string;
  // Nullable: the layout emits streets with no directory behind them (the
  // root spine), and every consumer already guards for it.
  dir: DirNode | null;
  orientation: StreetAxis;
  isRoot?: boolean;
}

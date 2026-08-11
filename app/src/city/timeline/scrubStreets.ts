// How a street renders at a scrub position, decided from the rollup over its
// descendant buildings. Pure: no meshes, no components, no signals — the scrub
// controller gathers the rollup, this decides, the controller applies.

import type { Street } from '@/types';

/** Asphalt tint lane, read by the streets machinery. */
export const StreetTint = {
  None: 0,
  Ruin: 1,
  Future: 2,
} as const;

export interface StreetScrubState {
  opacity: number;
  tint: (typeof StreetTint)[keyof typeof StreetTint];
  ruin: boolean;
  future: boolean;
}

/** What one pass over the buildings accumulates per street. A container street
 *  stays visible while ANY descendant file is live, so these are rollups over
 *  the whole ancestor chain, not just direct children. */
export interface StreetRollup {
  presentStreets: ReadonlySet<Street>;
  maxPresentOp: ReadonlyMap<Street, number>;
  ruinStreets: ReadonlySet<Street>;
}

export interface StreetScrubFlags {
  ruinsOn: boolean;
  futureOn: boolean;
}

/**
 * Present beats ruin beats future. A street with live descendants fades with
 * them (the max of their opacities, so one fully-present file keeps the road
 * solid); a ruin-only or future-only street renders opaque and is set apart by
 * tint instead. ROOT is always 1: the repo root exists even scrubbed back to an
 * empty tree.
 */
export function resolveStreetScrubState(
  street: Street,
  rollup: StreetRollup,
  flags: StreetScrubFlags
): StreetScrubState {
  const hasPresent = rollup.presentStreets.has(street);
  const ruin = flags.ruinsOn && !street.isRoot && !hasPresent && rollup.ruinStreets.has(street);
  const future = flags.futureOn && !street.isRoot && !hasPresent && !ruin;

  const opacity = street.isRoot
    ? 1
    : hasPresent
      ? (rollup.maxPresentOp.get(street) ?? 0)
      : ruin || future
        ? 1
        : 0;

  return {
    opacity,
    tint: ruin ? StreetTint.Ruin : future ? StreetTint.Future : StreetTint.None,
    ruin,
    future,
  };
}

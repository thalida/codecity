// How a street renders at a scrub position, from the rollup over its descendant
// buildings. No meshes, no signals: the pass gathers, this decides, the
// component applies.

import type { Street } from '@/types';

// The picker rejects hits on these; buildings use iKind instead. Republished by
// the streets component every scrub frame.
export const RUINED_STREET_DIRS = new Set<string>();
export const FUTURE_STREET_DIRS = new Set<string>();

/** Asphalt tint lane. */
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

/** Accumulated over the whole ancestor chain, not just direct children: a
 *  container street stays visible while ANY descendant file is live. */
export interface StreetRollup {
  presentStreets: ReadonlySet<Street>;
  maxPresentOp: ReadonlyMap<Street, number>;
  ruinStreets: ReadonlySet<Street>;
}

export interface StreetScrubFlags {
  ruinsOn: boolean;
  futureOn: boolean;
}

/** Present beats ruin beats future. A street with live descendants fades with
 *  them; a ruin-only or future-only one stays opaque and is set apart by tint.
 *  ROOT is always 1: the repo root exists even scrubbed back to an empty tree. */
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

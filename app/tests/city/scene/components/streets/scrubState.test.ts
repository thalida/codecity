// The street rollup decision, exercised directly. scrubPass.test.ts covers how
// the rollup itself is accumulated from buildings; what lives here is the
// decision table, which needs no scene.

import { describe, it, expect } from 'vitest';
import {
  resolveStreetScrubState,
  StreetTint,
  type StreetRollup,
} from '@/city/scene/components/streets/scrubState';
import type { Street } from '@/city/scene/types';

const street = (isRoot = false) => ({ isRoot, dir: { path: 'src' } }) as unknown as Street;

const rollup = (over: Partial<Record<'present' | 'ruin', boolean>> & { op?: number } = {}) => {
  const s = street();
  return {
    s,
    r: {
      presentStreets: new Set(over.present ? [s] : []),
      maxPresentOp: new Map(over.op != null ? [[s, over.op]] : []),
      ruinStreets: new Set(over.ruin ? [s] : []),
    } satisfies StreetRollup,
  };
};

const BOTH_ON = { ruinsOn: true };

describe('resolveStreetScrubState', () => {
  it.each([
    ['a live descendant', { present: true, op: 1 }, { opacity: 1, tint: StreetTint.None }],
    [
      'a half-faded descendant',
      { present: true, op: 0.4 },
      { opacity: 0.4, tint: StreetTint.None },
    ],
    // Present wins even when the street also has ruined descendants.
    [
      'present alongside a ruin',
      { present: true, op: 1, ruin: true },
      { opacity: 1, tint: StreetTint.None },
    ],
    ['ruined descendants only', { ruin: true }, { opacity: 1, tint: StreetTint.Ruin }],
    // Neither present nor ruined and the road exists in the union => not built yet.
    ['nothing yet', {}, { opacity: 0, tint: StreetTint.None }],
  ])('%s', (_label, over, expected) => {
    const { s, r } = rollup(over);
    const state = resolveStreetScrubState(s, r, BOTH_ON);
    expect(state.opacity).toBe(expected.opacity);
    expect(state.tint).toBe(expected.tint);
  });

  it('takes the max over descendants, so one deleted sibling cannot drag the road down', () => {
    const s = street();
    const r: StreetRollup = {
      presentStreets: new Set([s]),
      maxPresentOp: new Map([[s, 1]]),
      ruinStreets: new Set([s]),
    };
    expect(resolveStreetScrubState(s, r, BOTH_ON).opacity).toBe(1);
  });

  it('falls to 0 when a street is marked present but carries no rolled-up opacity', () => {
    const s = street();
    const r: StreetRollup = {
      presentStreets: new Set([s]),
      maxPresentOp: new Map(),
      ruinStreets: new Set(),
    };
    expect(resolveStreetScrubState(s, r, BOTH_ON).opacity).toBe(0);
  });

  describe('ROOT', () => {
    it('stays fully opaque and untinted with nothing present: the repo root always exists', () => {
      const s = street(true);
      const r: StreetRollup = {
        presentStreets: new Set(),
        maxPresentOp: new Map(),
        ruinStreets: new Set([s]),
      };
      const state = resolveStreetScrubState(s, r, BOTH_ON);
      expect(state.opacity).toBe(1);
      expect(state.tint).toBe(StreetTint.None);
      expect(state.ruin).toBe(false);
    });
  });

  describe('with ruins off', () => {
    it('a ruined-only street disappears rather than rendering as a ruin', () => {
      const { s, r } = rollup({ ruin: true });
      const state = resolveStreetScrubState(s, r, { ruinsOn: false });
      expect(state.opacity).toBe(0);
      expect(state.tint).toBe(StreetTint.None);
    });
  });
});

// The packer ticks once per node — 100k+ of them on a big repo. What reaches
// the main thread has to be far coarser than that.

import { describe, it, expect } from 'vitest';
import { createPackReporter } from '@/city/layout/packProgress';
import { layoutCity } from '@/city/layout/algorithm';
import { makeRng, genNestedTree } from '../../_helpers/layoutTreeFixtures';
import { layoutCfg } from '../../_helpers/citySettings';

const CFG = layoutCfg();

function run(total: number, ticks: number): number[] {
  const seen: number[] = [];
  const report = createPackReporter(total, (percent) => seen.push(percent));
  for (let i = 0; i < ticks; i++) report?.();
  return seen;
}

describe('createPackReporter', () => {
  it('emits each whole percent once, in order', () => {
    const seen = run(1000, 1000);
    expect(seen).toEqual([...new Set(seen)]); // no repeats
    expect([...seen].sort((a, b) => a - b)).toEqual(seen); // never goes backwards
    expect(seen.length).toBeLessThanOrEqual(100);
  });

  it('costs one message per percent, not one per node', () => {
    // 200k nodes is Linux scale; a message per node would swamp the thread it
    // is reporting to.
    expect(run(200_000, 200_000).length).toBeLessThanOrEqual(100);
  });

  it('holds at 99 — the last percent belongs to the finished layout', () => {
    const seen = run(50, 50);
    expect(Math.max(...seen)).toBe(99);
  });

  it('holds at 99 even when the tree turns out bigger than the count said', () => {
    const seen = run(50, 500);
    expect(Math.max(...seen)).toBe(99);
  });

  it('opts out entirely when the node count is unknown', () => {
    expect(createPackReporter(0, () => {})).toBeUndefined();
  });
});

describe('layoutCity — onPlaced', () => {
  const tree = genNestedTree('root', '.', 400, 0, makeRng(7));

  it('ticks once per node, which is what the worker meters against', () => {
    // The worker's denominator is the scanner's own descendants_count, so a
    // branch that forgot to tick would leave the percent short forever.
    let ticks = 0;
    layoutCity({ tree }, CFG, () => ticks++);
    expect(ticks).toBe(tree.descendants_count);
  });

  it('changes nothing about the layout it is measuring', () => {
    const measured = layoutCity({ tree }, CFG, () => {});
    expect(JSON.stringify(measured)).toBe(JSON.stringify(layoutCity({ tree }, CFG)));
  });
});

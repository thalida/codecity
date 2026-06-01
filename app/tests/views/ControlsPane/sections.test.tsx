import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { DynamicSection, type SectionChild, type FieldRef } from '@/views/ControlsPane/partials';
import { TREES_SECTION } from '@/views/ControlsPane/partials/Trees';
import { STREETS_SECTION } from '@/views/ControlsPane/partials/Streets';
import { FOOTPRINT_SECTION } from '@/views/ControlsPane/partials/Footprint';
import { BUILDINGS_SECTION } from '@/views/ControlsPane/partials/Buildings';
import { TREES } from '@/state/stores/settings/trees';
import {
  STREETS,
  STREET_TIERS,
  STREET_LAYOUT,
  BUILDING_DIMENSIONS,
  BUILDINGS,
  FACADE,
  BUILDING_FADE,
} from '@/state/stores/settings/index';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { getFieldKeys } from '@/state/schema';
import { flush } from '../../_helpers/preact';

// Walk a section's node tree and collect every field reference (depth-first).
function collectRefs(children: SectionChild[]): FieldRef[] {
  const out: FieldRef[] = [];
  for (const c of children) {
    if ('children' in c) out.push(...collectRefs(c.children));
    else out.push(c);
  }
  return out;
}

describe('TREES_SECTION placement', () => {
  it('places every TREES field (incl. folded outline) exactly once', () => {
    const refs = collectRefs(TREES_SECTION.children ?? []);
    const placed = refs.map((r) => r.key);

    // Every defined (tunable) field is placed …
    expect(placed.slice().sort()).toEqual(getFieldKeys(TREES as object).sort());
    // … and none is placed twice.
    expect(new Set(placed).size).toBe(placed.length);
    // Every ref points at the TREES store (no stray stores).
    expect(refs.every((r) => r.store === (TREES as unknown))).toBe(true);
  });
});

describe('STREETS_SECTION placement', () => {
  it('places every field of the three streets stores exactly once', () => {
    const refs = collectRefs(STREETS_SECTION.children ?? []);
    const stores = [STREETS, STREET_TIERS, STREET_LAYOUT];
    let total = 0;
    for (const store of stores) {
      const placed = refs.filter((r) => r.store === (store as unknown)).map((r) => r.key);
      expect(placed.slice().sort()).toEqual(getFieldKeys(store as object).sort());
      expect(new Set(placed).size).toBe(placed.length); // none twice
      total += getFieldKeys(store as object).length;
    }
    // No refs point at a store outside the three (footprint is its own section).
    expect(refs.length).toBe(total);
  });
});

describe('FOOTPRINT_SECTION placement', () => {
  it('places every FOOTPRINT field exactly once', () => {
    const refs = collectRefs(FOOTPRINT_SECTION.children ?? []);
    const placed = refs.map((r) => r.key);
    expect(placed.slice().sort()).toEqual(getFieldKeys(FOOTPRINT as object).sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(refs.every((r) => r.store === (FOOTPRINT as unknown))).toBe(true);
  });
});

describe('BUILDINGS_SECTION placement', () => {
  it('places every field of all four building stores exactly once', () => {
    const refs = collectRefs(BUILDINGS_SECTION.children ?? []);
    const stores = [BUILDING_DIMENSIONS, BUILDINGS, FACADE, BUILDING_FADE];
    let total = 0;
    for (const store of stores) {
      const placed = refs.filter((r) => r.store === (store as unknown)).map((r) => r.key);
      expect(placed.slice().sort()).toEqual(getFieldKeys(store as object).sort());
      expect(new Set(placed).size).toBe(placed.length); // none twice
      total += getFieldKeys(store as object).length;
    }
    // No refs point at a store outside the four.
    expect(refs.length).toBe(total);
  });
});

describe('DynamicSection rendering', () => {
  let container: HTMLDivElement;
  afterEach(() => {
    if (container) {
      render(null, container);
      container.remove();
    }
  });

  it('renders the section title, the subgroup labels, and one row per field', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    render(<DynamicSection node={TREES_SECTION} />, container);
    await flush();

    // Section + subgroup headers.
    expect(container.textContent).toContain('Trees');
    expect(container.textContent).toContain('Height by age');
    expect(container.textContent).toContain('Outlines');

    // One .theme-row per placed field (RangePair counts as one row).
    const placed = collectRefs(TREES_SECTION.children ?? []).length;
    expect(container.querySelectorAll('.theme-row').length).toBe(placed);
  });
});

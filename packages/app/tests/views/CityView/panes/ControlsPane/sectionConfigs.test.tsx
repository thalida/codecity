import { CITY_STORES, HOME_BACKDROP } from '@/features/settings/state/values/city';
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { DynamicSection } from '@/features/settings/components/DynamicSection/DynamicSection';
import type { SectionChild, FieldRef } from '@/features/city/components/ControlsPane/types';
import { TREES_SECTION } from '@/features/city/components/ControlsPane/sectionConfigs/Trees';
import { BUILDINGS_SECTION } from '@/features/city/components/ControlsPane/sectionConfigs/Buildings';
import { CONTROLS_SECTIONS } from '@/features/city/components/ControlsPane/ControlsPane';
import { getFieldKeys, isAutosave } from '@/features/settings/state/schema';
import { flush } from '../../../../_helpers/preact';

// Walk a section's node tree and collect every field reference (depth-first).
function collectRefs(children: SectionChild[]): FieldRef[] {
  const out: FieldRef[] = [];
  for (const c of children) {
    if ('children' in c) out.push(...collectRefs(c.children));
    else out.push(c);
  }
  return out;
}

// Every store the controls pane is responsible for surfacing. A store added
// here but left unplaced, or a field dropped in a move, fails below.
const CONTROLS_STORES: [string, object][] = [
  ['CITY_STORES.CAMERA', CITY_STORES.CAMERA],
  ['HOME_BACKDROP', HOME_BACKDROP],
  ['CITY_STORES.SCENE', CITY_STORES.SCENE],
  ['CITY_STORES.WORLD', CITY_STORES.WORLD],
  ['CITY_STORES.ISLAND', CITY_STORES.ISLAND],
  ['CITY_STORES.STREETS', CITY_STORES.STREETS],
  ['CITY_STORES.STREET_TIERS', CITY_STORES.STREET_TIERS],
  ['CITY_STORES.STREET_LAYOUT', CITY_STORES.STREET_LAYOUT],
  ['CITY_STORES.FOOTPRINT', CITY_STORES.FOOTPRINT],
  ['CITY_STORES.BUILDING_DIMENSIONS', CITY_STORES.BUILDING_DIMENSIONS],
  ['CITY_STORES.BUILDINGS', CITY_STORES.BUILDINGS],
  ['CITY_STORES.GEM', CITY_STORES.GEM],
  ['CITY_STORES.GEM_SIZING', CITY_STORES.GEM_SIZING],
  ['CITY_STORES.REPO_LABEL', CITY_STORES.REPO_LABEL],
  ['CITY_STORES.TREES', CITY_STORES.TREES],
  ['CITY_STORES.FIREFLIES', CITY_STORES.FIREFLIES],
  ['CITY_STORES.RUINS', CITY_STORES.RUINS],
  ['CITY_STORES.SCRUBBER', CITY_STORES.SCRUBBER],
  ['CITY_STORES.RAINBOW', CITY_STORES.RAINBOW],
  ['CITY_STORES.BLOOM', CITY_STORES.BLOOM],
];

describe('World tab coverage', () => {
  const refs = CONTROLS_SECTIONS.flatMap((s) => collectRefs(s.children ?? []));

  it('places every field of every World store exactly once', () => {
    for (const [name, store] of CONTROLS_STORES) {
      const placed = refs.filter((r) => r.store === (store as unknown)).map((r) => r.key);
      expect(placed.slice().sort(), name).toEqual(getFieldKeys(store).sort());
      expect(new Set(placed).size, `${name} placed a field twice`).toBe(placed.length);
    }
  });

  it('places nothing from a store outside that set', () => {
    const known = new Set(CONTROLS_STORES.map(([, s]) => s as unknown));
    expect(refs.filter((r) => !known.has(r.store))).toEqual([]);
  });

  it('has no write-through fields: every one stages into the footer', () => {
    // An autosave store here would skip staging AND be ignored by Reset all
    // (stageResetAll / anyResettable both bow out of autosave stores).
    const writeThrough = CONTROLS_SECTIONS.flatMap((s) =>
      collectRefs(s.children ?? [])
        .filter((r) => isAutosave(r.store as object))
        .map((r) => `${s.key}.${r.key}`)
    );
    expect(writeThrough, writeThrough.join(', ')).toEqual([]);
  });

  it('gives every section and group a unique key', () => {
    const keys: string[] = [];
    const walk = (children: SectionChild[]) => {
      for (const c of children) {
        if (!('children' in c)) continue;
        keys.push(c.key);
        walk(c.children);
      }
    };
    for (const s of CONTROLS_SECTIONS) {
      keys.push(s.key);
      walk(s.children ?? []);
    }
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes, dupes.join(', ')).toEqual([]);
  });
});

// A section mounts its body on first open, so these tests open it the way a
// user does before asserting on the fields inside.
async function openSections(root: HTMLElement): Promise<void> {
  root
    .querySelectorAll<HTMLButtonElement>('.controls-section-summary .controls-disclosure-toggle')
    .forEach((t) => t.click());
  await flush();
}

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
    await openSections(container);

    expect(container.textContent).toContain('Trees');
    expect(container.textContent).toContain('Placement');
    expect(container.textContent).toContain('Height by Age');

    // One .setting-row per placed field (RangePairField counts as one row).
    const placed = collectRefs(TREES_SECTION.children ?? []).length;
    expect(container.querySelectorAll('.setting-row').length).toBe(placed);
  });

  it('caps collapsible nesting at MAX_COLLAPSE_DEPTH: deeper groups render flat', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Buildings nests Section > Interaction (2) > Selection fade (3) > tier (4).
    render(<DynamicSection node={BUILDINGS_SECTION} />, container);
    await flush();
    await openSections(container);

    const toggles = Array.from(container.querySelectorAll('.controls-disclosure-toggle')).map(
      (s) => s.textContent ?? ''
    );
    // Selection fade (depth 3) is still a collapsible accordion.
    expect(toggles.some((t) => t.includes('Selection Fade'))).toBe(true);
    // A fade tier (depth 4) is past the cap → a flat labeled cluster, no toggle…
    expect(toggles.some((t) => t.includes('Level 1'))).toBe(false);
    // …but its label + fields still render.
    expect(container.textContent).toContain('Level 1');
  });
});

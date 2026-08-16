import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { DynamicSection } from '@/components/DynamicSection/DynamicSection';
import type { SectionChild, FieldRef } from '@/types/controls';
import { TREES_SECTION } from '@/panes/ControlsPane/sectionConfigs/Trees';
import { BUILDINGS_SECTION } from '@/panes/ControlsPane/sectionConfigs/Buildings';
import { CONTROLS_SECTIONS } from '@/panes/ControlsPane/ControlsPane';
import { CAMERA } from '@/state/stores/settings/camera';
import { SHOWCASE } from '@/state/stores/settings/showcase';
import { SCENE } from '@/state/stores/settings/scene';
import { ISLAND, WORLD } from '@/state/stores/settings/island';
import { STREETS, STREET_TIERS, STREET_LAYOUT } from '@/state/stores/settings/streets';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { GEM, GEM_SIZING, REPO_LABEL } from '@/state/stores/settings/gem';
import { TREES } from '@/state/stores/settings/trees';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import { RUINS } from '@/state/stores/settings/ruins';
import { SCRUBBER } from '@/state/stores/settings/scrubber';
import { RAINBOW, BLOOM } from '@/state/stores/settings/effects';
import { getFieldKeys, isAutosave } from '@/state/settingsSchema';
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

// Every store the controls pane is responsible for surfacing. A store added
// here but left unplaced, or a field dropped in a move, fails below.
const CONTROLS_STORES: [string, object][] = [
  ['CAMERA', CAMERA],
  ['SHOWCASE', SHOWCASE],
  ['SCENE', SCENE],
  ['WORLD', WORLD],
  ['ISLAND', ISLAND],
  ['STREETS', STREETS],
  ['STREET_TIERS', STREET_TIERS],
  ['STREET_LAYOUT', STREET_LAYOUT],
  ['FOOTPRINT', FOOTPRINT],
  ['BUILDING_DIMENSIONS', BUILDING_DIMENSIONS],
  ['BUILDINGS', BUILDINGS],
  ['GEM', GEM],
  ['GEM_SIZING', GEM_SIZING],
  ['REPO_LABEL', REPO_LABEL],
  ['TREES', TREES],
  ['FIREFLIES', FIREFLIES],
  ['RUINS', RUINS],
  ['SCRUBBER', SCRUBBER],
  ['RAINBOW', RAINBOW],
  ['BLOOM', BLOOM],
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
    expect(container.textContent).toContain('Height by age');

    // One .setting-row per placed field (RangePair counts as one row).
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
    expect(toggles.some((t) => t.includes('Selection fade'))).toBe(true);
    // A fade tier (depth 4) is past the cap → a flat labeled cluster, no toggle…
    expect(toggles.some((t) => t.includes('Level 1'))).toBe(false);
    // …but its label + fields still render.
    expect(container.textContent).toContain('Level 1');
  });
});

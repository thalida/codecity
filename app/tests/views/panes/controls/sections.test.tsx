import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { GeneratedSection, TREES_SECTION, type SectionChild, type FieldRef } from '@/views/panes/controls/sections';
import { TREES, TREE_OUTLINE } from '@/state/settings/components/trees';
import { getFieldKeys } from '@/state/settings/schema';
import { flush } from '../../../_helpers/preact';

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
  it('places every TREES + TREE_OUTLINE field exactly once', () => {
    const refs = collectRefs(TREES_SECTION.children ?? []);

    const treesPlaced = refs.filter((r) => r.store === (TREES as unknown)).map((r) => r.key);
    const outlinePlaced = refs.filter((r) => r.store === (TREE_OUTLINE as unknown)).map((r) => r.key);

    // Every defined (tunable) field is placed …
    expect(treesPlaced.slice().sort()).toEqual(getFieldKeys(TREES as object).sort());
    expect(outlinePlaced.slice().sort()).toEqual(getFieldKeys(TREE_OUTLINE as object).sort());
    // … and none is placed twice.
    expect(new Set(treesPlaced).size).toBe(treesPlaced.length);
    expect(new Set(outlinePlaced).size).toBe(outlinePlaced.length);
    // Every ref points at a store we recognise (no stray stores).
    expect(refs.length).toBe(treesPlaced.length + outlinePlaced.length);
  });
});

describe('GeneratedSection rendering', () => {
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
    render(<GeneratedSection node={TREES_SECTION} />, container);
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

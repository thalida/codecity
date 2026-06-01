import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { DynamicSection, type SectionChild, type FieldRef } from '@/views/panes/controls/sections';
import { TREES_SECTION } from '@/views/panes/controls/sections/trees';
import { TREES } from '@/state/settings/trees';
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

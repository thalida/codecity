// views/ControlsPane/partials/index.tsx — The controls panel's ARRANGEMENT
// layer (the components + helpers). Stores (state/stores/settings) own what each field
// *is*; this owns where each field *sits*.
//
// - field(store, key): a typed (store, key) reference — a wrong key is a
//   compile error.
// - SectionNode / GroupNode: the recursive section → subgroup → field tree.
//   Groups nest arbitrarily (Buildings › Aging › Tilt is just depth).
// - DynamicSection: one recursive renderer that turns a node into the existing
//   Section / Subgroup / Field shells, replacing the hand-written
//   *Section.tsx files.
//
// Per-section declarations live in sibling files (./trees, …) and import field()
// + the types from here; this module does NOT import them back (no cycle).

import type { Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { Section } from '@/components/Section/Section';
import { Subgroup } from '@/components/Subgroup/Subgroup';
import { Field } from '@/components/Field';

// ── Node types ───────────────────────────────────────────────────────────────

/** A typed reference to one field of a store. */
export interface FieldRef {
  store: Signal<unknown>;
  key: string;
}

/** Reference a field by store + key — `key` must be a key of the store's
 *  config, so typos and dangling refs fail at compile time. */
export function field<T>(store: Signal<T>, key: keyof T & string): FieldRef {
  return { store: store as Signal<unknown>, key };
}

/** A subgroup: a labeled container that nests further groups and/or field
 *  refs. Collapsible (a <details>) by default; set collapsible:false for a
 *  plain always-open labeled group (the old <Subgroup>). */
export interface GroupNode {
  key: string;
  label: string;
  description?: string;
  collapsible?: boolean;
  children: SectionChild[];
}

export type SectionChild = GroupNode | FieldRef;

/** A top-level panel section: schema-driven (label + children) or bespoke
 *  (render — a not-yet-migrated *Section component, which supplies its own
 *  header, so `label` is unused there). */
export interface SectionNode {
  key: string;
  label?: string;
  description?: string;
  children?: SectionChild[];
  render?: ComponentChildren;
}

function isGroup(child: SectionChild): child is GroupNode {
  return 'children' in child;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/** Collect every field ref under a node tree (depth-first) — the fields a
 *  section/group reset button stages-resets. */
function collectRefs(children: SectionChild[]): FieldRef[] {
  const out: FieldRef[] = [];
  for (const c of children) {
    if (isGroup(c)) out.push(...collectRefs(c.children));
    else out.push(c);
  }
  return out;
}

function renderChild(child: SectionChild): ComponentChildren {
  if (isGroup(child)) {
    const kids = child.children.map(renderChild);
    // Collapsible by default — a <details> that resets every field beneath it
    // (draft-driven via resetKeys). collapsible:false renders a plain group
    // with no reset.
    const collapsible = child.collapsible !== false;
    return (
      <Subgroup
        name={child.label}
        collapsible={collapsible}
        resetKeys={collapsible ? collectRefs(child.children) : undefined}
        key={child.key}
      >
        {kids}
      </Subgroup>
    );
  }
  return <Field store={child.store} fieldKey={child.key} key={`${child.key}`} />;
}

/** Render one section node into the panel shells. */
export function DynamicSection({ node }: { node: SectionNode }) {
  if (node.render) return <>{node.render}</>;
  return (
    <Section
      name={node.label ?? ''}
      hint={node.description}
      resetKeys={collectRefs(node.children ?? [])}
    >
      {(node.children ?? []).map(renderChild)}
    </Section>
  );
}

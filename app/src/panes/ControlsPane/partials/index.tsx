// panes/ControlsPane/partials — the panel's ARRANGEMENT layer: the stores own
// what each field IS, this owns where it SITS. field() is a typed (store, key)
// reference, SectionNode/GroupNode the recursive tree, DynamicSection the one
// renderer. Sibling files declare sections and import from here, never back.

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

/** A labeled container nesting further groups and fields. Collapsible by
 *  default; collapsible:false makes it a plain always-open group. */
export interface GroupNode {
  key: string;
  label: string;
  description?: ComponentChildren;
  collapsible?: boolean;
  children: SectionChild[];
}

export type SectionChild = GroupNode | FieldRef;

/** A top-level section: schema-driven (label + children), or bespoke (render),
 *  which brings its own header and ignores `label`. */
export interface SectionNode {
  key: string;
  label?: string;
  /** Prose under the section title. A component here can react to state, e.g.
   *  a section that only applies to some sources explaining when it doesn't. */
  description?: ComponentChildren;
  children?: SectionChild[];
  render?: ComponentChildren;
  /** Start the accordion expanded instead of collapsed. */
  defaultOpen?: boolean;
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

/** Deepest level that stays an accordion (the top section is 1). Deeper groups
 *  render flat, so the panel never becomes a maze of nested accordions. */
export const MAX_COLLAPSE_DEPTH = 3;

/** Children at their nesting level. Every render path goes through here, or a
 *  direct .map would pass the array index as the depth. */
function renderChildren(children: SectionChild[], depth = 2): ComponentChildren[] {
  return children.map((c) => renderChild(c, depth));
}

function renderChild(child: SectionChild, depth: number): ComponentChildren {
  if (isGroup(child)) {
    // Collapsible only within MAX_COLLAPSE_DEPTH; past it, a plain labeled
    // group with no reset of its own.
    const collapsible = child.collapsible !== false && depth <= MAX_COLLAPSE_DEPTH;
    return (
      <Subgroup
        name={child.label}
        collapsible={collapsible}
        resetKeys={collapsible ? collectRefs(child.children) : undefined}
        key={child.key}
      >
        {renderChildren(child.children, depth + 1)}
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
      defaultOpen={node.defaultOpen}
    >
      {(node.children ?? []).map((c) => renderChild(c, 2))}
    </Section>
  );
}

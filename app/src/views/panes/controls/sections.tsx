// views/panes/controls/sections.tsx — The controls panel's ARRANGEMENT layer.
//
// Stores (state/settings) own what each field *is*. This file owns where each
// field *sits*: the recursive section → subgroup → field tree, plus section
// labels and descriptions. Leaves are typed (store, key) references via
// field() — a wrong key is a compile error. One recursive renderer
// (GeneratedSection) turns a node into the existing Section / CollapsibleSubgroup
// / Field shells, so this replaces the hand-written *Section.tsx files.

import type { Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { Field } from './Field';
import { TREES, TREE_OUTLINE } from '@/state/settings/components/trees';

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

/** A subgroup: a labeled, collapsible container that nests further groups
 *  and/or field refs (Buildings › Aging › Tilt is just depth). */
export interface GroupNode {
  key: string;
  label: string;
  description?: string;
  children: SectionChild[];
}

export type SectionChild = GroupNode | FieldRef;

/** A top-level panel section: schema-driven (children) or bespoke (render). */
export interface SectionNode {
  key: string;
  label: string;
  description?: string;
  children?: SectionChild[];
  /** Bespoke sections (Shortcuts, Debug) render a component instead of fields. */
  render?: ComponentChildren;
}

function isGroup(child: SectionChild): child is GroupNode {
  return 'children' in child;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function renderChild(child: SectionChild): ComponentChildren {
  if (isGroup(child)) {
    return (
      <CollapsibleSubgroup name={child.label} key={child.key}>
        {child.children.map(renderChild)}
      </CollapsibleSubgroup>
    );
  }
  return <Field store={child.store} fieldKey={child.key} key={`${child.key}`} />;
}

/** Render one section node into the panel shells. */
export function GeneratedSection({ node }: { node: SectionNode }) {
  if (node.render) return <>{node.render}</>;
  return (
    <Section name={node.label} hint={node.description}>
      {(node.children ?? []).map(renderChild)}
    </Section>
  );
}

// ── Section registry ───────────────────────────────────────────────────────────
// Migrated sections live here; the rest stay hand-written in ControlsPane until
// they're converted, then move in.

export const TREES_SECTION: SectionNode = {
  key: 'trees',
  label: 'Trees',
  description:
    'One tree per commit — height tracks age, width + facets track file count, color tracks commits-per-day (same-day commits share a color).',
  children: [
    { key: 'visibility', label: 'Visibility', children: [field(TREES, 'TREES_ENABLED')] },
    {
      key: 'placement',
      label: 'Placement',
      children: [field(TREES, 'EDGE_INSET_PERCENT'), field(TREES, 'TREE_DENSITY_FALLOFF')],
    },
    {
      key: 'color',
      label: 'Color by commits-per-day',
      children: [
        field(TREES, 'TREE_COLOR_BUSY_DAY'),
        field(TREES, 'TREE_COLOR_SOLO_DAY'),
        field(TREES, 'TREE_TRUNK_COLOR'),
        field(TREES, 'TREE_SHADING_STRENGTH'),
      ],
    },
    {
      key: 'age-desat',
      label: 'Age desaturation',
      children: [field(TREES, 'TREE_AGE_DESAT_ENABLED'), field(TREES, 'TREE_AGE_SATURATION')],
    },
    {
      key: 'height',
      label: 'Height by age',
      children: [
        field(TREES, 'TREE_MIN_HEIGHT'),
        field(TREES, 'TREE_MAX_HEIGHT'),
        field(TREES, 'TRUNK_HEIGHT_FRAC'),
        field(TREES, 'CANOPY_TRUNK_OVERLAP_FRAC'),
      ],
    },
    {
      key: 'width',
      label: 'Width by files',
      children: [
        field(TREES, 'TREE_MIN_WIDTH'),
        field(TREES, 'TREE_MAX_WIDTH'),
        field(TREES, 'TRUNK_RADIUS_FRAC_OF_CANOPY'),
        field(TREES, 'TREE_WIDTH_AGE_FLOOR'),
      ],
    },
    {
      key: 'facets',
      label: 'Facets by files',
      children: [
        field(TREES, 'TREE_FACETS_LOW'),
        field(TREES, 'TREE_FACETS_MID'),
        field(TREES, 'TREE_FACETS_HIGH'),
      ],
    },
    {
      key: 'outlines',
      label: 'Outlines',
      children: [
        field(TREE_OUTLINE, 'WIDTH'),
        field(TREE_OUTLINE, 'HOVER_COLOR'),
        field(TREE_OUTLINE, 'HOVER_OPACITY'),
        field(TREE_OUTLINE, 'SELECTED_OPACITY'),
      ],
    },
  ],
};

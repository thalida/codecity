// features/settings/components/DynamicSection/DynamicSection.tsx — turns one section config into the Section /
// Subgroup / Field shells, recursively.

import { Section } from '@/features/settings/components/Section/Section';
import { Subgroup } from '@/features/settings/components/Subgroup/Subgroup';
import { Field } from '@/features/settings/components/Field/Field';
import type { ComponentChildren } from 'preact';
import type {
  FieldRef,
  GroupNode,
  SectionChild,
  SectionNode,
} from '@/features/city/components/ControlsPane/types';

/** A group nests; a field reference is a leaf. */
function isGroup(child: SectionChild): child is GroupNode {
  return 'children' in child;
}

/** Every field beneath a node, for its reset button. */
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

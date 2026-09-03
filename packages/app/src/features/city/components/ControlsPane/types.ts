// features/city/components/ControlsPane/types.ts — the shape of a controls-pane section config: what a
// section declares, and what a field reference in it is. The configs are data
// (panes/ControlsPane/sectionConfigs); this is only their shape.

import type { Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';

/** A typed reference to one field of a store. */
export interface FieldRef {
  store: Signal<unknown>;
  key: string;
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

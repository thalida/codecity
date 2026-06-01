// views/ControlsPane/Subgroup.tsx — Non-collapsible labeled group of
// rows. Used to cluster related rows under a header (e.g. "Stars" inside
// the Scene section).

import type { ComponentChildren } from 'preact';

export interface SubgroupProps {
  name: string;
  children: ComponentChildren;
}

export function Subgroup({ name, children }: SubgroupProps) {
  return (
    <div class="theme-subgroup">
      <div class="text-label text-label--muted">{name}</div>
      {children}
    </div>
  );
}

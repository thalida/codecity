// components/PaneEmpty/PaneEmpty.tsx — what a pane shows instead of content:
// a glyph, a headline and an optional line under it. The .empty-state styles are
// shared (styles/empty-state.css), so there is nothing colocated here.

import type { LucideIcon } from 'lucide-preact';

export interface PaneEmptyProps {
  /** Lucide glyph component (e.g. `FolderOpen` from lucide-preact); omit for
   *  a text-only empty state. */
  icon?: LucideIcon;
  title: string;
  sub?: string;
  /** Large variant (bigger icon) — the default for selection panes. */
  large?: boolean;
  /** Extra empty-state modifier class, e.g. empty-state--absent. */
  modifier?: string;
}

export function PaneEmpty({ icon: Icon, title, sub, large = true, modifier }: PaneEmptyProps) {
  const base = large ? 'empty-state empty-state--lg' : 'empty-state';
  return (
    <div class={modifier ? `${base} ${modifier}` : base}>
      {Icon && <Icon class="icon" />}
      <p class="text-card-title">{title}</p>
      {sub && <p class="text-card-sub">{sub}</p>}
    </div>
  );
}

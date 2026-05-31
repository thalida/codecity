// views/components/LucideIcon.tsx — Generic Lucide icon painted via CSS
// mask so it picks up currentColor. Used by every monochrome glyph
// (chevrons, settings cog, close X, etc.). Sizing comes from the
// parent's font-size (1em × 1em).

import { LUCIDE_ICON_BASE_URL } from '@/constants';

export interface LucideIconProps {
  /** Lucide icon basename (no .svg suffix), e.g. 'chevron-right'. */
  name: string;
  /** Extra class added alongside `lucide-icon`. */
  class?: string;
  /** Tooltip shown on hover (sets the title attr). */
  title?: string;
}

export function LucideIcon({ name, class: cls, title }: LucideIconProps) {
  const url = `url(${LUCIDE_ICON_BASE_URL}${name}.svg)`;
  return (
    <span
      class={`lucide-icon${cls ? ` ${cls}` : ''}`}
      aria-hidden="true"
      title={title}
      style={{ maskImage: url, WebkitMaskImage: url }}
    />
  );
}

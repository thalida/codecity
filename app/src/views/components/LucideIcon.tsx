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

interface IconOpts {
  /** Extra class added alongside `lucide-icon`. */
  class?: string;
  /** Tooltip shown on hover (sets the title attr). */
  title?: string;
}

/**
 * Imperative DOM factory — same component, for callers that haven't
 * yet ported to Preact. Phase 3c/3d will delete it.
 *
 * @param name Lucide icon basename (no .svg suffix), e.g. 'chevron-right'.
 */
export function makeLucideIcon(name: string, opts: IconOpts = {}): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `lucide-icon${opts.class ? ` ${opts.class}` : ''}`;
  span.setAttribute('aria-hidden', 'true');
  if (opts.title) span.title = opts.title;
  const url = `url(${LUCIDE_ICON_BASE_URL}${name}.svg)`;
  span.style.maskImage = url;
  span.style.webkitMaskImage = url;
  return span;
}

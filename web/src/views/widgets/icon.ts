// views/widgets/icon.ts — Tiny helper for inline Lucide icons. The icon is
// painted via a CSS mask so it automatically picks up the parent's
// currentColor. Sizing comes from the parent's font-size (1em × 1em).

import { LUCIDE_ICON_BASE_URL } from '@/constants';

interface IconOpts {
  /** Extra class added alongside `lucide-icon`. */
  class?: string;
  /** Tooltip shown on hover (sets the title attr). */
  title?: string;
}

/**
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

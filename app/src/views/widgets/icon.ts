// views/widgets/icon.ts — Tiny helpers for inline icons.
//
// makeLucideIcon  — generic Lucide icon painted via CSS mask so it picks
//                   up currentColor (used by every monochrome glyph).
// makeGemIcon     — the codecity gem (full multicolor by default; simple
//                   monochrome variant for inline-with-text use).
//
// Sizing comes from the parent's font-size (1em × 1em).

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

interface GemIconOpts extends IconOpts {
  /** Render the monochrome outline variant (mask-image, follows currentColor).
   *  Use this when the gem appears inline with text (e.g. tree rows). The
   *  default (false) renders the full multicolor SVG via background-image. */
  simple?: boolean;
}

/**
 * The codecity gem icon. Default = full multicolor (same SVG as the favicon,
 * loaded from /gem.svg). Simple variant = monochrome outline, /gem-simple.svg,
 * painted with currentColor like any other lucide-icon.
 */
export function makeGemIcon(opts: GemIconOpts = {}): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  if (opts.title) span.title = opts.title;
  if (opts.simple) {
    span.className = `lucide-icon${opts.class ? ` ${opts.class}` : ''}`;
    const url = 'url(/gem-simple.svg)';
    span.style.maskImage = url;
    span.style.webkitMaskImage = url;
  } else {
    span.className = `gem-icon${opts.class ? ` ${opts.class}` : ''}`;
  }
  return span;
}

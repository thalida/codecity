// views/components/icon.ts — Tiny helpers for inline icons.
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
  /** Render the grayscale-filled variant for quieter contexts (e.g. tree
   *  rows) where the multicolor palette would compete with row text. Same
   *  octahedron geometry, just neutral fills instead of palette colors. */
  simple?: boolean;
}

/**
 * The codecity gem icon, painted as a background-image SVG so the per-face
 * fills render directly. Default = full multicolor (/gem.svg, same source
 * as the favicon). Simple = grayscale variant (/gem-simple.svg) for inline
 * use in trees/lists.
 */
export function makeGemIcon(opts: GemIconOpts = {}): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `gem-icon${opts.class ? ` ${opts.class}` : ''}`;
  span.setAttribute('aria-hidden', 'true');
  if (opts.title) span.title = opts.title;
  if (opts.simple) {
    span.style.backgroundImage = 'url(/gem-simple.svg)';
  }
  return span;
}

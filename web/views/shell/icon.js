// views/shell/icon.js — Tiny helper for inline Lucide icons. The icon is
// painted via a CSS mask so it automatically picks up the parent's
// currentColor. Sizing comes from the parent's font-size (1em × 1em).

import { LUCIDE_ICON_BASE_URL } from '../../constants.js';

// makeLucideIcon(name, opts) -> HTMLSpanElement
//
//   name        — Lucide icon basename (no .svg suffix), e.g. 'chevron-right'.
//   opts.class  — extra class added alongside `lucide-icon`.
//   opts.title  — tooltip shown on hover (sets the title attr).
export function makeLucideIcon(name, opts) {
  opts = opts || {};
  var span = document.createElement('span');
  span.className = 'lucide-icon' + (opts.class ? ' ' + opts.class : '');
  span.setAttribute('aria-hidden', 'true');
  if (opts.title) span.title = opts.title;
  var url = "url(" + LUCIDE_ICON_BASE_URL + name + ".svg)";
  span.style.maskImage       = url;
  span.style.webkitMaskImage = url;
  return span;
}

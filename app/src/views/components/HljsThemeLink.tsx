// views/components/HljsThemeLink.tsx — Signals-native replacement for the
// old imperative applyHljsTheme(). Renders a <link rel=stylesheet> into
// document.head via Preact's createPortal so the syntax-highlighting CSS
// follows the SYNTAX_THEME signal automatically — no module-load effect,
// no manual <link> element management.

import { createPortal } from 'preact/compat';
import { SYNTAX_THEME } from '@/state/stores/settings/syntaxTheme';

const HLJS_VERSION = '11.11.1';

export function HljsThemeLink() {
  const href = `https://cdn.jsdelivr.net/npm/highlight.js@${HLJS_VERSION}/styles/${SYNTAX_THEME.value}.min.css`;
  return createPortal(<link id="hljs-theme" rel="stylesheet" href={href} />, document.head);
}

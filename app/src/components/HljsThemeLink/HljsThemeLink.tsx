// components/HljsThemeLink.tsx — Signals-native replacement for the
// old imperative applyHljsTheme(). Renders a <link rel=stylesheet> into
// document.head via Preact's createPortal so the syntax-highlighting CSS
// follows the SYNTAX_THEME signal automatically — no module-load effect,
// no manual <link> element management.
//
// Bundled same-origin rather than fetched from a CDN: remote CSS leaks the
// viewer's IP and theme choice, breaks offline use, and can exfiltrate via
// attribute-selector url(). `?url` keeps each theme a separate asset, so only
// the selected one is fetched.

import './HljsThemeLink.css';
import { createPortal } from 'preact/compat';
import {
  SYNTAX_THEME,
  SYNTAX_THEME_DEFAULT,
  type SyntaxThemeValue,
} from '@/state/stores/settings/syntaxTheme';

import a11yDark from 'highlight.js/styles/a11y-dark.min.css?url';
import agate from 'highlight.js/styles/agate.min.css?url';
import androidstudio from 'highlight.js/styles/androidstudio.min.css?url';
import atomOneDark from 'highlight.js/styles/atom-one-dark.min.css?url';
import cybertopiaCherry from 'highlight.js/styles/cybertopia-cherry.min.css?url';
import cybertopiaIcecap from 'highlight.js/styles/cybertopia-icecap.min.css?url';
import dracula from 'highlight.js/styles/base16/dracula.min.css?url';
import githubDark from 'highlight.js/styles/github-dark.min.css?url';
import irBlack from 'highlight.js/styles/ir-black.min.css?url';
import monokai from 'highlight.js/styles/monokai.min.css?url';
import monokaiSublime from 'highlight.js/styles/monokai-sublime.min.css?url';
import nightOwl from 'highlight.js/styles/night-owl.min.css?url';
import nord from 'highlight.js/styles/nord.min.css?url';
import obsidian from 'highlight.js/styles/obsidian.min.css?url';
import rosePine from 'highlight.js/styles/rose-pine.min.css?url';
import rosePineMoon from 'highlight.js/styles/rose-pine-moon.min.css?url';
import shadesOfPurple from 'highlight.js/styles/shades-of-purple.min.css?url';
import solarizedDark from 'highlight.js/styles/base16/solarized-dark.min.css?url';
import stackoverflowDark from 'highlight.js/styles/stackoverflow-dark.min.css?url';
import tokyoNightDark from 'highlight.js/styles/tokyo-night-dark.min.css?url';
import vs2015 from 'highlight.js/styles/vs2015.min.css?url';

// Keyed on SyntaxThemeValue, so adding an option without its stylesheet is a
// typecheck failure rather than a silently unstyled pane.
export const THEME_HREF: Record<SyntaxThemeValue, string> = {
  'a11y-dark': a11yDark,
  agate,
  androidstudio,
  'atom-one-dark': atomOneDark,
  'cybertopia-cherry': cybertopiaCherry,
  'cybertopia-icecap': cybertopiaIcecap,
  'base16/dracula': dracula,
  'github-dark': githubDark,
  'ir-black': irBlack,
  monokai,
  'monokai-sublime': monokaiSublime,
  'night-owl': nightOwl,
  nord,
  obsidian,
  'rose-pine': rosePine,
  'rose-pine-moon': rosePineMoon,
  'shades-of-purple': shadesOfPurple,
  'base16/solarized-dark': solarizedDark,
  'stackoverflow-dark': stackoverflowDark,
  'tokyo-night-dark': tokyoNightDark,
  vs2015,
};

export function hrefForTheme(theme: string): string {
  return THEME_HREF[theme as SyntaxThemeValue] ?? THEME_HREF[SYNTAX_THEME_DEFAULT];
}

export function HljsThemeLink() {
  return createPortal(
    <link id="hljs-theme" rel="stylesheet" href={hrefForTheme(SYNTAX_THEME.value)} />,
    document.head
  );
}

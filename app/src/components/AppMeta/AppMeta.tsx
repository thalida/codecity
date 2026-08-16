// components/AppMeta/AppMeta.tsx — What codecity says about itself: which build
// is running, where the source is, and who made it.
//
// Three surfaces show these, in different arrangements: the app header carries
// about, the app footer splits version and credit across its two ends, and the
// project switcher runs all three under the wordmark. One definition each, so
// the wording, the URLs and the link targets cannot drift apart.
//
// Link treatment is the surface's call, via `linkClass`: the app chrome keeps
// its links at icon/prose weight so a status bar doesn't turn into a row of
// accents, while the landing uses the house `.link` (accent + always underlined,
// see styles/text.css) because nothing around it signals a link.

import './AppMeta.css';
import { SERVER_CONFIG } from '@/state/stores/serverData';
import { REPO_URL, CREATOR_URL } from '@/constants/ui';

/** The running build's version, as reported by the server. */
export function MetaVersion() {
  return <span class="meta-version">v{SERVER_CONFIG.value.version}</span>;
}

export interface MetaLinkProps {
  /** House link class from styles/text.css: `link` or `link--chrome`. Omit to
   *  let the surface's own CSS colour it. */
  linkClass?: string;
}

/** Outward link to the repo. */
export function MetaAbout({ linkClass }: MetaLinkProps = {}) {
  return (
    <a
      class={linkClass ? `meta-link ${linkClass}` : 'meta-link'}
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="codecity on GitHub"
    >
      about
    </a>
  );
}

/** Authorship, linked to the author's site. */
export function MetaCredit({ linkClass }: MetaLinkProps = {}) {
  return (
    <span class="meta-credit">
      made by 🦄{' '}
      <a
        class={linkClass ? `meta-link ${linkClass}` : 'meta-link'}
        href={CREATOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="thalida.com"
      >
        thalida.
      </a>
    </span>
  );
}

/** All three on one line, separated. Used where there's room for the full set. */
export function MetaLine({ linkClass }: MetaLinkProps = {}) {
  return (
    <span class="meta-line">
      <MetaVersion />
      <span class="meta-sep">·</span>
      <MetaAbout linkClass={linkClass} />
      <span class="meta-sep">·</span>
      <MetaCredit linkClass={linkClass} />
    </span>
  );
}

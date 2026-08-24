// components/app/MetaLine/MetaLine.tsx — what codecity says about itself: the
// build, the source and who made it. Three surfaces arrange these differently
// (header, footer, switcher), so one definition each keeps the wording and the
// link targets from drifting. `linkClass` leaves the treatment to the surface.
import './MetaLine.css';
import { SERVER_CONFIG } from '@/state/stores/serverData';
import { REPO_URL, CREATOR_URL } from '@/constants/ui';

/** The running build's version, as reported by the server. */
function MetaVersion() {
  return <span class="meta-version">v{SERVER_CONFIG.value.version}</span>;
}

export interface MetaLinkProps {
  /** House link class from styles/text.css: `link` or `link--chrome`. Omit to
   *  let the surface's own CSS colour it. */
  linkClass?: string;
}

/** Outward link to the repo, named for where it goes: "about" read as a page
 *  describing the project rather than the source and its setup. */
function MetaRepo({ linkClass }: MetaLinkProps = {}) {
  return (
    <a
      class={linkClass ? `meta-link ${linkClass}` : 'meta-link'}
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="codecity on GitHub"
    >
      GitHub
    </a>
  );
}

/** Authorship, linked to the author's site. */
function MetaCredit({ linkClass }: MetaLinkProps = {}) {
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
      <MetaRepo linkClass={linkClass} />
      <span class="meta-sep">·</span>
      <MetaCredit linkClass={linkClass} />
    </span>
  );
}

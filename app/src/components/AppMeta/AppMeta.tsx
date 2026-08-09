// components/AppMeta/AppMeta.tsx — What codecity says about itself: which build
// is running, where the source is, and who made it.
//
// Three surfaces show these, in different arrangements: the app header carries
// about, the app footer splits version and credit across its two ends, and the
// project switcher runs all three under the wordmark. One definition each, so
// the wording, the URLs and the link targets cannot drift apart.
//
// Colour is left to the surface (see each one's CSS): the header keeps its link
// at icon weight, the footer lifts it above the prose around it.

import './AppMeta.css';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { REPO_URL, CREATOR_URL } from '@/constants/ui';

/** The running build's version, as reported by the server. */
export function MetaVersion() {
  return <span class="meta-version">v{SERVER_CONFIG.value.version}</span>;
}

/** Outward link to the repo. */
export function MetaAbout() {
  return (
    <a
      class="meta-link"
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
export function MetaCredit() {
  return (
    <span class="meta-credit">
      made by 🦄{' '}
      <a
        class="meta-link"
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
export function MetaLine() {
  return (
    <span class="meta-line">
      <MetaVersion />
      <span class="meta-sep">·</span>
      <MetaAbout />
      <span class="meta-sep">·</span>
      <MetaCredit />
    </span>
  );
}

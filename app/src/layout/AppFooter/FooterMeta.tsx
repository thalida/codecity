// layout/FooterMeta.tsx — The footer's two meta bits, at opposite ends.
//
// Version sits bottom-left with the build status: both answer "what is running
// right now", and it comes from the server rather than a bundled constant, so a
// released image reports its own tag. Credit sits bottom-right, the quiet
// corner. The outward link to the repo lives in the app header.

import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { CREATOR_URL } from '@/constants/ui';

export function FooterVersion() {
  return <span class="app-footer-version">v{SERVER_CONFIG.value.version}</span>;
}

export function FooterCredit() {
  return (
    <span class="app-footer-credit">
      made by 🦄{' '}
      <a
        class="app-footer-link"
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

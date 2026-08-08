// layout/FooterMeta.tsx — The footer's centered credit line, styled as a code
// comment: build version, repo link, attribution. The version comes from the
// server (the running build's package metadata), so it stays accurate for a
// released image without a bundled constant to keep in sync.

import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { REPO_URL } from '@/constants/ui';
import { FooterSep } from './FooterSep';

const CREATOR_URL = 'https://thalida.com';

export function FooterMeta() {
  return (
    <span class="app-footer-meta">
      <span class="app-footer-meta-comment" aria-hidden="true">
        //
      </span>
      <span class="app-footer-meta-version">v{SERVER_CONFIG.value.version}</span>
      <FooterSep />
      <a
        class="app-footer-meta-link"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="codecity on GitHub"
      >
        about
      </a>
      <FooterSep />
      <span class="app-footer-meta-credit">
        made by 🦄{' '}
        <a
          class="app-footer-meta-link"
          href={CREATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="thalida.com"
        >
          thalida.
        </a>
      </span>
    </span>
  );
}

// utils/readmeAssets.ts — Resolve README image/asset references to servable
// URLs. The README is rendered in the Info panel via marked; its relative
// image paths (e.g. ./docs/banner.png) would otherwise resolve against the
// app origin and 404. We rewrite repo-relative refs to route through
// /api/file, resolved against the README's own directory.

import { fileUrl } from '@/api/file';

// Skip rewriting for anything already addressable as-is: a URL with a scheme
// (http:, https:, data:, blob:, mailto:, …), a protocol-relative URL (//host),
// or a bare fragment (#anchor).
const _ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Resolve a README asset `href` to a URL the browser can load. Absolute URLs
 * pass through untouched; repo-relative paths are resolved against the
 * README's directory and routed through the /api/file endpoint.
 *
 * `readmeFullPath` is the README's absolute server path (posix). A leading
 * slash on `href` is treated as repo-root-relative — since the only README we
 * render is the repo-root one, that's the README's own directory.
 */
export function resolveReadmeAssetUrl(href: string, readmeFullPath: string): string {
  if (!href || _ABSOLUTE.test(href)) return href;
  const dir = readmeFullPath.slice(0, readmeFullPath.lastIndexOf('/'));
  // Drop any ?query / #fragment (e.g. GitHub's #gh-dark-mode-only) — the
  // served file is just the path.
  const relPath = href.replace(/^\/+/, '').split(/[?#]/)[0];
  const segs = dir.split('/');
  for (const part of relPath.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segs.length > 1) segs.pop();
      continue;
    }
    segs.push(part);
  }
  return fileUrl(segs.join('/'));
}

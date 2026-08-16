// readmeAssets.ts — README asset refs to URLs the browser can load. A relative
// image path would resolve against the app origin and 404, so repo-relative
// refs are rewritten through /api/file, against the README's own directory.

import { fileUrl } from '@/api/file';

// Already addressable as-is: a scheme, a protocol-relative //host, or a bare
// #anchor.
const _ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Absolute URLs pass through; repo-relative ones route through /api/file. A
 *  leading slash is repo-root-relative, which is this README's own directory. */
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

// Matches the src="…" / src='…' of a raw-HTML <img> tag. The leading whitespace
// before `src` keeps it from matching attributes like `data-src`.
const _IMG_SRC = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])(.*?)\2/gi;

/** The same rewrite for raw-HTML <img> tags: marked emits those as `html`
 *  tokens, which the image-token hook never sees. Run it per html token. */
export function rewriteHtmlImageUrls(html: string, readmeFullPath: string): string {
  return html.replace(
    _IMG_SRC,
    (_full, prefix: string, quote: string, src: string) =>
      `${prefix}${quote}${resolveReadmeAssetUrl(src, readmeFullPath)}${quote}`
  );
}

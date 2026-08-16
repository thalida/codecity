import { describe, it, expect } from 'vitest';
import {
  resolveReadmeAssetUrl,
  rewriteHtmlImageUrls,
} from '@/views/CityView/panes/ExplorePane/tabs/ReadmeTab/readmeAssets';
import { fileUrl } from '@/api/file';

const README = '/cache/repo/README.md';

describe('resolveReadmeAssetUrl', () => {
  it('resolves a ./relative image against the README directory', () => {
    expect(resolveReadmeAssetUrl('./docs/banner.png', README)).toBe(
      fileUrl('/cache/repo/docs/banner.png')
    );
  });

  it('resolves a bare relative path', () => {
    expect(resolveReadmeAssetUrl('docs/banner.png', README)).toBe(
      fileUrl('/cache/repo/docs/banner.png')
    );
  });

  it('resolves ../ segments relative to the README directory', () => {
    expect(resolveReadmeAssetUrl('../assets/logo.png', '/cache/repo/sub/README.md')).toBe(
      fileUrl('/cache/repo/assets/logo.png')
    );
  });

  it('treats a leading slash as repo-root-relative (README dir)', () => {
    expect(resolveReadmeAssetUrl('/img/logo.png', README)).toBe(
      fileUrl('/cache/repo/img/logo.png')
    );
  });

  it('strips a #fragment / ?query before resolving', () => {
    expect(resolveReadmeAssetUrl('logo.png#gh-dark-mode-only', README)).toBe(
      fileUrl('/cache/repo/logo.png')
    );
    expect(resolveReadmeAssetUrl('logo.png?v=2', README)).toBe(fileUrl('/cache/repo/logo.png'));
  });

  it('passes absolute http(s) URLs through untouched', () => {
    const u = 'https://img.shields.io/badge/x-y.svg';
    expect(resolveReadmeAssetUrl(u, README)).toBe(u);
  });

  it('passes protocol-relative and data URLs through untouched', () => {
    expect(resolveReadmeAssetUrl('//cdn.example.com/x.png', README)).toBe(
      '//cdn.example.com/x.png'
    );
    expect(resolveReadmeAssetUrl('data:image/png;base64,AAAA', README)).toBe(
      'data:image/png;base64,AAAA'
    );
  });

  it('returns an empty href unchanged', () => {
    expect(resolveReadmeAssetUrl('', README)).toBe('');
  });
});

describe('rewriteHtmlImageUrls', () => {
  it('rewrites a relative <img src> (with other attributes) through /api/file', () => {
    const html = '<img src=".github/readme/banner.png" alt="banner" width="100%" />';
    expect(rewriteHtmlImageUrls(html, README)).toBe(
      `<img src="${fileUrl('/cache/repo/.github/readme/banner.png')}" alt="banner" width="100%" />`
    );
  });

  it('handles single-quoted src', () => {
    const html = "<img alt='x' src='docs/demo.gif'>";
    expect(rewriteHtmlImageUrls(html, README)).toBe(
      `<img alt='x' src='${fileUrl('/cache/repo/docs/demo.gif')}'>`
    );
  });

  it('rewrites multiple <img> tags in one fragment', () => {
    const html = '<img src="a.png"><p>x</p><img src="b.png">';
    expect(rewriteHtmlImageUrls(html, README)).toBe(
      `<img src="${fileUrl('/cache/repo/a.png')}"><p>x</p><img src="${fileUrl('/cache/repo/b.png')}">`
    );
  });

  it('leaves absolute src untouched', () => {
    const html = '<img src="https://img.shields.io/badge/x.svg" alt="badge">';
    expect(rewriteHtmlImageUrls(html, README)).toBe(html);
  });

  it('does not touch non-img tags or data-src', () => {
    expect(rewriteHtmlImageUrls('<a href="docs/x.png">link</a>', README)).toBe(
      '<a href="docs/x.png">link</a>'
    );
    expect(rewriteHtmlImageUrls('<img data-src="docs/x.png" src="real.png">', README)).toBe(
      `<img data-src="docs/x.png" src="${fileUrl('/cache/repo/real.png')}">`
    );
  });
});

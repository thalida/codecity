import { describe, it, expect } from 'vitest';

import { resolveReadmeAssetUrl, rewriteHtmlImageUrls } from '../src/client/readmeAssets';
import { createClient } from '../src/client/index';
import { TEST_SOURCE } from './_helpers/manifestFixtures';

// The same client a host would hand in; these are about the URL a repo-relative
// asset resolves to, not about where the API lives.
const API = createClient({ baseUrl: '/api' });

const README = 'README.md';
const NESTED = 'sub/README.md';

describe('resolveReadmeAssetUrl', () => {
  it('resolves a ./relative image against the README directory', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, './docs/banner.png', README)).toBe(
      API.fileUrl(TEST_SOURCE, 'docs/banner.png')
    );
  });

  it('resolves a bare relative path', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, 'docs/banner.png', README)).toBe(
      API.fileUrl(TEST_SOURCE, 'docs/banner.png')
    );
  });

  it('resolves ../ segments relative to the README directory', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, '../assets/logo.png', NESTED)).toBe(
      API.fileUrl(TEST_SOURCE, 'assets/logo.png')
    );
  });

  it('treats a leading slash as repo-root-relative (README dir)', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, '/img/logo.png', README)).toBe(
      API.fileUrl(TEST_SOURCE, 'img/logo.png')
    );
  });

  it('strips a #fragment / ?query before resolving', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, 'logo.png#gh-dark-mode-only', README)).toBe(
      API.fileUrl(TEST_SOURCE, 'logo.png')
    );
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, 'logo.png?v=2', README)).toBe(
      API.fileUrl(TEST_SOURCE, 'logo.png')
    );
  });

  it('passes absolute http(s) URLs through untouched', () => {
    const u = 'https://img.shields.io/badge/x-y.svg';
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, u, README)).toBe(u);
  });

  it('passes protocol-relative and data URLs through untouched', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, '//cdn.example.com/x.png', README)).toBe(
      '//cdn.example.com/x.png'
    );
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, 'data:image/png;base64,AAAA', README)).toBe(
      'data:image/png;base64,AAAA'
    );
  });

  it('returns an empty href unchanged', () => {
    expect(resolveReadmeAssetUrl(API, TEST_SOURCE, '', README)).toBe('');
  });
});

describe('rewriteHtmlImageUrls', () => {
  it('rewrites a relative <img src> (with other attributes) through /api/file', () => {
    const html = '<img src=".github/readme/banner.png" alt="banner" width="100%" />';
    expect(rewriteHtmlImageUrls(API, TEST_SOURCE, html, README)).toBe(
      `<img src="${API.fileUrl(TEST_SOURCE, '.github/readme/banner.png')}" alt="banner" width="100%" />`
    );
  });

  it('handles single-quoted src', () => {
    const html = "<img alt='x' src='docs/demo.gif'>";
    expect(rewriteHtmlImageUrls(API, TEST_SOURCE, html, README)).toBe(
      `<img alt='x' src='${API.fileUrl(TEST_SOURCE, 'docs/demo.gif')}'>`
    );
  });

  it('rewrites multiple <img> tags in one fragment', () => {
    const html = '<img src="a.png"><p>x</p><img src="b.png">';
    expect(rewriteHtmlImageUrls(API, TEST_SOURCE, html, README)).toBe(
      `<img src="${API.fileUrl(TEST_SOURCE, 'a.png')}"><p>x</p><img src="${API.fileUrl(TEST_SOURCE, 'b.png')}">`
    );
  });

  it('leaves absolute src untouched', () => {
    const html = '<img src="https://img.shields.io/badge/x.svg" alt="badge">';
    expect(rewriteHtmlImageUrls(API, TEST_SOURCE, html, README)).toBe(html);
  });

  it('does not touch non-img tags or data-src', () => {
    expect(rewriteHtmlImageUrls(API, TEST_SOURCE, '<a href="docs/x.png">link</a>', README)).toBe(
      '<a href="docs/x.png">link</a>'
    );
    expect(
      rewriteHtmlImageUrls(API, TEST_SOURCE, '<img data-src="docs/x.png" src="real.png">', README)
    ).toBe(`<img data-src="docs/x.png" src="${API.fileUrl(TEST_SOURCE, 'real.png')}">`);
  });
});

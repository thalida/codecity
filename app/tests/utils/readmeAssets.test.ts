import { describe, it, expect } from 'vitest';
import { resolveReadmeAssetUrl } from '@/utils/readmeAssets';
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
    expect(resolveReadmeAssetUrl('//cdn.example.com/x.png', README)).toBe('//cdn.example.com/x.png');
    expect(resolveReadmeAssetUrl('data:image/png;base64,AAAA', README)).toBe(
      'data:image/png;base64,AAAA'
    );
  });

  it('returns an empty href unchanged', () => {
    expect(resolveReadmeAssetUrl('', README)).toBe('');
  });
});

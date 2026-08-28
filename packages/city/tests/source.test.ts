import { describe, it, expect } from 'vitest';
import {
  srcKind,
  SourceKind,
  identityBranch,
  sourceIdentity,
  sameSourceIdentity,
  sourceKey,
  looksLikePath,
} from '../src/source';

// NOTE: repo display-name derivation lives entirely server-side now (see
// api/tests/test_source.py — label_from_source / display_name_for_manifest).
// The client reads a server-provided name (tree.name, or the `label` on a
// progress event); there is no client-side URL→label transform to test here.

describe('srcKind', () => {
  it('classifies https URLs as remote', () => {
    expect(srcKind('https://github.com/foo/bar.git')).toBe(SourceKind.Remote);
  });
  it('classifies SSH URLs as remote', () => {
    expect(srcKind('git@github.com:foo/bar.git')).toBe(SourceKind.Remote);
  });
  it('classifies local paths as local', () => {
    expect(srcKind('/Users/x/repo')).toBe(SourceKind.Local);
    expect(srcKind('./relative')).toBe(SourceKind.Local);
    expect(srcKind('bare-name')).toBe(SourceKind.Local);
  });
});

describe('identityBranch', () => {
  it('keeps the branch for a remote source', () => {
    expect(identityBranch('https://github.com/o/r', 'main')).toBe('main');
    expect(identityBranch('git@github.com:o/r.git', 'dev')).toBe('dev');
    expect(identityBranch('https://github.com/o/r', undefined)).toBeUndefined();
  });
  it('drops the branch for a local source (no branch axis)', () => {
    expect(identityBranch('/Users/x/repo', 'main')).toBeUndefined();
    expect(identityBranch('./relative', 'feat/x')).toBeUndefined();
    expect(identityBranch('/Users/x/repo', undefined)).toBeUndefined();
  });
});

describe('sourceIdentity', () => {
  it('is equal for the same src + branch and differs on either', () => {
    expect(sourceIdentity('https://x/r', 'main')).toBe(sourceIdentity('https://x/r', 'main'));
    expect(sourceIdentity('https://x/r', 'main')).not.toBe(sourceIdentity('https://x/r', 'dev'));
    expect(sourceIdentity('https://x/r')).not.toBe(sourceIdentity('https://y/r'));
  });
  it('treats undefined and empty-string branch as the same (no branch)', () => {
    expect(sourceIdentity('/foo', undefined)).toBe(sourceIdentity('/foo', ''));
  });
});

describe('sameSourceIdentity', () => {
  it('matches two refs with the same identity', () => {
    expect(sameSourceIdentity({ src: '/foo' }, { src: '/foo', branch: undefined })).toBe(true);
    expect(
      sameSourceIdentity(
        { src: 'https://x/r', branch: 'main' },
        { src: 'https://x/r', branch: 'main' }
      )
    ).toBe(true);
  });
  it('rejects a different src or branch', () => {
    expect(sameSourceIdentity({ src: '/foo' }, { src: '/bar' })).toBe(false);
    expect(
      sameSourceIdentity(
        { src: 'https://x/r', branch: 'main' },
        { src: 'https://x/r', branch: 'dev' }
      )
    ).toBe(false);
  });
});

describe('sourceKey', () => {
  it('is deterministic for the same (src, branch)', () => {
    expect(sourceKey('https://x/r', 'main')).toBe(sourceKey('https://x/r', 'main'));
  });

  it('distinguishes branches for a remote source', () => {
    expect(sourceKey('https://x/r', 'main')).not.toBe(sourceKey('https://x/r', 'develop'));
  });

  it('distinguishes (src, undefined) from (src, "main") for a remote source', () => {
    expect(sourceKey('https://x/r')).not.toBe(sourceKey('https://x/r', 'main'));
  });

  it('produces a short alphanumeric string', () => {
    const k = sourceKey('/Users/example/repos/codecity');
    expect(k).toMatch(/^[a-z0-9]{1,10}$/);
  });
});

describe('looksLikePath', () => {
  it('is true for clear filesystem paths', () => {
    expect(looksLikePath('/Users/x/repo')).toBe(true);
    expect(looksLikePath('~/projects/x')).toBe(true);
    expect(looksLikePath('./relative')).toBe(true);
    expect(looksLikePath('../up')).toBe(true);
    expect(looksLikePath('C:\\repo')).toBe(true);
    expect(looksLikePath('  /leading/space')).toBe(true);
  });
  it('is false for URLs and half-typed URLs (so the field never flashes a path error)', () => {
    expect(looksLikePath('https://github.com/o/r')).toBe(false);
    expect(looksLikePath('git@github.com:o/r')).toBe(false);
    expect(looksLikePath('h')).toBe(false);
    expect(looksLikePath('http')).toBe(false);
    expect(looksLikePath('bare-name')).toBe(false);
    expect(looksLikePath('')).toBe(false);
  });
});

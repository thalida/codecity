import { describe, it, expect } from 'vitest';
import { srcKind, SourceKind, srcNeedsBranch, looksLikePath } from '@/utils/sources';

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

describe('srcNeedsBranch', () => {
  it('is true for a remote URL with no branch (must be picked)', () => {
    expect(srcNeedsBranch('https://github.com/o/r')).toBe(true);
    expect(srcNeedsBranch('git@github.com:o/r.git', '')).toBe(true);
  });
  it('is false once a remote URL has a branch', () => {
    expect(srcNeedsBranch('https://github.com/o/r', 'main')).toBe(false);
  });
  it('is false for a local path (no branch axis)', () => {
    expect(srcNeedsBranch('/Users/x/repo')).toBe(false);
    expect(srcNeedsBranch('./relative', undefined)).toBe(false);
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

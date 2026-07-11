import { describe, it, expect } from 'vitest';
import {
  srcKind,
  SourceKind,
  toHttpsRepoUrl,
  repoUrlForBranch,
  srcNeedsBranch,
} from '@/utils/sources';

// NOTE: repo display-name derivation lives entirely server-side now (see
// api/tests/test_source.py — label_from_source / display_name_for_manifest).
// The client reads a server-provided name (tree.name, or the `label` on a
// progress event); there is no client-side URL→label transform to test here.

describe('toHttpsRepoUrl', () => {
  it('passes https URLs through unchanged', () => {
    expect(toHttpsRepoUrl('https://github.com/foo/bar')).toBe('https://github.com/foo/bar');
  });

  it('converts ssh URLs to https form', () => {
    expect(toHttpsRepoUrl('git@github.com:foo/bar.git')).toBe('https://github.com/foo/bar');
  });
});

describe('repoUrlForBranch', () => {
  it('uses /tree for GitHub and sr.ht', () => {
    expect(repoUrlForBranch('https://github.com/foo/bar', 'main')).toBe(
      'https://github.com/foo/bar/tree/main'
    );
    expect(repoUrlForBranch('https://sr.ht/~foo/bar', 'main')).toBe(
      'https://sr.ht/~foo/bar/tree/main'
    );
  });

  it('uses /-/tree for GitLab', () => {
    expect(repoUrlForBranch('https://gitlab.com/foo/bar', 'dev')).toBe(
      'https://gitlab.com/foo/bar/-/tree/dev'
    );
  });

  it('uses /src/branch for Gitea/Forgejo/Codeberg', () => {
    expect(repoUrlForBranch('https://codeberg.org/foo/bar', 'main')).toBe(
      'https://codeberg.org/foo/bar/src/branch/main'
    );
  });

  it('uses /src for Bitbucket', () => {
    expect(repoUrlForBranch('https://bitbucket.org/foo/bar', 'main')).toBe(
      'https://bitbucket.org/foo/bar/src/main'
    );
  });

  it('encodes slashes and other special chars in the branch ref', () => {
    expect(repoUrlForBranch('https://github.com/foo/bar', 'feature/x')).toBe(
      'https://github.com/foo/bar/tree/feature%2Fx'
    );
  });

  it('returns the bare repo URL for unrecognised hosts', () => {
    expect(repoUrlForBranch('https://example.com/foo/bar', 'main')).toBe(
      'https://example.com/foo/bar'
    );
  });
});

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

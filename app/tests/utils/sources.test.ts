import { describe, it, expect } from 'vitest';
import {
  labelFromSource,
  srcKind,
  SourceKind,
  toHttpsRepoUrl,
  repoUrlForBranch,
  srcNeedsBranch,
} from '@/utils/sources';

// NOTE: the manifest → display-name derivation (display_root / remote_url /
// tree.name precedence) now lives server-side — see api/tests/test_source.py
// (display_name_for_manifest). labelFromSource here only labels a PENDING
// source string (URL or path) before its manifest loads.
describe('labelFromSource', () => {
  it('parses org/repo from an https URL', () => {
    expect(labelFromSource('https://github.com/foo/bar')).toBe('foo/bar');
  });

  it('strips an @branch suffix before parsing', () => {
    expect(labelFromSource('https://github.com/foo/bar@main')).toBe('foo/bar');
  });

  it('parses org/repo from an ssh URL', () => {
    expect(labelFromSource('git@github.com:foo/bar.git')).toBe('foo/bar');
  });

  it('falls back to the local-path basename for a path', () => {
    expect(labelFromSource('/Users/me/code/myproject')).toBe('myproject');
  });

  it('returns null for empty / nullish input', () => {
    expect(labelFromSource('')).toBeNull();
    expect(labelFromSource(null)).toBeNull();
    expect(labelFromSource(undefined)).toBeNull();
  });
});

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

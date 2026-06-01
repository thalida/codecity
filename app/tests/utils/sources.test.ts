import { describe, it, expect } from 'vitest';
import {
  labelFromManifest,
  labelFromUrl,
  srcKind,
  SourceKind,
  toHttpsRepoUrl,
  repoUrlForBranch,
} from '@/utils/sources';
import type { Manifest } from '@/types/manifest';

// Test helper: build the minimal Manifest shape labelFromManifest reads,
// stamping only the fields a given test cares about. We don't strictly
// need full Manifest fidelity here — labelFromManifest only touches
// display_root, repo.remote_url, and tree.name — so a Partial cast keeps
// the test concise without widening prod types.
function manifest(partial: {
  display_root?: string;
  remote_url?: string | null;
  treeName?: string;
}): Manifest {
  return {
    display_root: partial.display_root,
    repo: { remote_url: partial.remote_url ?? null } as Manifest['repo'],
    tree: { name: partial.treeName ?? '' } as Manifest['tree'],
  } as Manifest;
}

describe('labelFromUrl', () => {
  it('parses org/repo from an https URL', () => {
    expect(labelFromUrl('https://github.com/foo/bar')).toBe('foo/bar');
  });

  it('strips an @branch suffix before parsing', () => {
    expect(labelFromUrl('https://github.com/foo/bar@main')).toBe('foo/bar');
  });

  it('parses org/repo from an ssh URL', () => {
    expect(labelFromUrl('git@github.com:foo/bar.git')).toBe('foo/bar');
  });

  it('falls back to the local-path basename for a path', () => {
    expect(labelFromUrl('/Users/me/code/myproject')).toBe('myproject');
  });

  it('returns null for empty / nullish input', () => {
    expect(labelFromUrl('')).toBeNull();
    expect(labelFromUrl(null)).toBeNull();
    expect(labelFromUrl(undefined)).toBeNull();
  });
});

describe('labelFromManifest', () => {
  it('parses org/repo from a display_root URL', () => {
    expect(labelFromManifest(manifest({ display_root: 'https://github.com/foo/bar' }))).toBe(
      'foo/bar'
    );
  });

  it('strips an @branch suffix on the display root before parsing', () => {
    expect(labelFromManifest(manifest({ display_root: 'https://github.com/foo/bar@main' }))).toBe(
      'foo/bar'
    );
  });

  it('parses org/repo from an ssh display root', () => {
    expect(labelFromManifest(manifest({ display_root: 'git@github.com:foo/bar.git' }))).toBe(
      'foo/bar'
    );
  });

  it('falls back to the local-path basename when display root is a path', () => {
    expect(labelFromManifest(manifest({ display_root: '/Users/me/code/myproject' }))).toBe(
      'myproject'
    );
  });

  it('uses remote_url when display_root is absent (local repo with a remote)', () => {
    expect(
      labelFromManifest(
        manifest({ remote_url: 'https://github.com/foo/bar', treeName: 'myproject' })
      )
    ).toBe('foo/bar');
  });

  it('prefers display_root over remote_url when both are set', () => {
    expect(
      labelFromManifest(
        manifest({
          display_root: 'https://github.com/displayed/repo',
          remote_url: 'https://github.com/other/repo',
        })
      )
    ).toBe('displayed/repo');
  });

  it('falls back to tree.name when neither display_root nor remote_url is set', () => {
    expect(labelFromManifest(manifest({ treeName: 'myproject' }))).toBe('myproject');
    expect(labelFromManifest(manifest({ remote_url: null, treeName: 'myproject' }))).toBe(
      'myproject'
    );
  });

  it('returns null for a null/undefined manifest', () => {
    expect(labelFromManifest(null)).toBeNull();
    expect(labelFromManifest(undefined)).toBeNull();
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
  it('classifies https URLs as git', () => {
    expect(srcKind('https://github.com/foo/bar.git')).toBe(SourceKind.Git);
  });
  it('classifies SSH URLs as git', () => {
    expect(srcKind('git@github.com:foo/bar.git')).toBe(SourceKind.Git);
  });
  it('classifies local paths as local', () => {
    expect(srcKind('/Users/x/repo')).toBe(SourceKind.Local);
    expect(srcKind('./relative')).toBe(SourceKind.Local);
    expect(srcKind('bare-name')).toBe(SourceKind.Local);
  });
});

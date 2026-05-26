import { describe, it, expect } from 'vitest';
import { labelFromDisplayRoot, toHttpsRepoUrl } from '@/views/widgets/displayLabel.js';

describe('labelFromDisplayRoot', () => {
  it('parses org/repo from an https display root', () => {
    expect(labelFromDisplayRoot('https://github.com/foo/bar', null, 'fallback')).toBe('foo/bar');
  });

  it('strips an @branch suffix on the display root before parsing', () => {
    expect(labelFromDisplayRoot('https://github.com/foo/bar@main', null, 'fallback')).toBe(
      'foo/bar'
    );
  });

  it('parses org/repo from an ssh display root', () => {
    expect(labelFromDisplayRoot('git@github.com:foo/bar.git', null, 'fallback')).toBe('foo/bar');
  });

  it('falls back to the local-path basename when display root is a path', () => {
    expect(labelFromDisplayRoot('/Users/me/code/myproject', null, 'fallback')).toBe('myproject');
  });

  it('uses remote_url when display_root is absent (local repo with a remote)', () => {
    expect(labelFromDisplayRoot(undefined, 'https://github.com/foo/bar', 'myproject')).toBe(
      'foo/bar'
    );
  });

  it('prefers display_root over remote_url when both are set', () => {
    expect(
      labelFromDisplayRoot(
        'https://github.com/displayed/repo',
        'https://github.com/other/repo',
        'fallback'
      )
    ).toBe('displayed/repo');
  });

  it('falls back to the supplied name when neither display_root nor remote_url is set', () => {
    expect(labelFromDisplayRoot(undefined, null, 'myproject')).toBe('myproject');
    expect(labelFromDisplayRoot(undefined, undefined, 'myproject')).toBe('myproject');
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

import { describe, it, expect } from 'vitest';
import { commitUrl, nodeUrl } from '../../src/data/remoteUrls';

describe('commitUrl', () => {
  it('appends /commit/<sha> for a github URL', () => {
    expect(commitUrl('https://github.com/org/repo', 'a'.repeat(40))).toBe(
      `https://github.com/org/repo/commit/${'a'.repeat(40)}`
    );
  });

  it('works for a gitlab URL with subgroups', () => {
    expect(commitUrl('https://gitlab.com/group/sub/repo', 'b'.repeat(40))).toBe(
      `https://gitlab.com/group/sub/repo/commit/${'b'.repeat(40)}`
    );
  });

  it('works for bitbucket', () => {
    expect(commitUrl('https://bitbucket.org/org/repo', 'c'.repeat(40))).toBe(
      `https://bitbucket.org/org/repo/commit/${'c'.repeat(40)}`
    );
  });

  it('does not double-slash when the remote ends with /', () => {
    expect(commitUrl('https://github.com/org/repo/', 'd'.repeat(40))).toBe(
      `https://github.com/org/repo/commit/${'d'.repeat(40)}`
    );
  });

  it('returns null for an empty remote', () => {
    expect(commitUrl('', 'a'.repeat(40))).toBeNull();
  });

  it('returns null for an empty sha', () => {
    expect(commitUrl('https://github.com/org/repo', '')).toBeNull();
  });
});

describe('nodeUrl', () => {
  it('builds a /blob/<ref>/<path> URL for a file', () => {
    expect(nodeUrl('https://github.com/org/repo', 'main', 'src/app.ts', false)).toBe(
      'https://github.com/org/repo/blob/main/src/app.ts'
    );
  });

  it('builds a /tree/<ref>/<path> URL for a directory', () => {
    expect(nodeUrl('https://github.com/org/repo', 'main', 'src/utils', true)).toBe(
      'https://github.com/org/repo/tree/main/src/utils'
    );
  });

  it('encodes ref and path segments and strips leading slashes', () => {
    expect(nodeUrl('https://github.com/org/repo/', 'feat/x', '/a b/c.ts', false)).toBe(
      'https://github.com/org/repo/blob/feat%2Fx/a%20b/c.ts'
    );
  });

  it('returns null for an empty remote, ref, or path', () => {
    expect(nodeUrl('', 'main', 'a.ts', false)).toBeNull();
    expect(nodeUrl('https://github.com/org/repo', '', 'a.ts', false)).toBeNull();
    expect(nodeUrl('https://github.com/org/repo', 'main', '', true)).toBeNull();
  });
});

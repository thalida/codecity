import { describe, it, expect } from 'vitest';
import { commitUrl } from '@/views/panes/commitUrl.js';

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

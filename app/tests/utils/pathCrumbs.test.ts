import { describe, it, expect } from 'vitest';
import { buildPathCrumbs } from '@/utils/pathCrumbs';

const ROOT = { isDir: true, rootLabel: 'codecity', rootPath: '' };

describe('buildPathCrumbs', () => {
  it('splits a nested path into cumulative segments', () => {
    const { isRoot, crumbs } = buildPathCrumbs('app/src/utils', {
      isDir: true,
      rootLabel: 'codecity',
      rootPath: '',
    });
    expect(isRoot).toBe(false);
    expect(crumbs).toEqual([
      { label: 'app', segPath: 'app' },
      { label: 'src', segPath: 'app/src' },
      { label: 'utils', segPath: 'app/src/utils' },
    ]);
  });

  it('collapses the root directory to a single repo-label crumb', () => {
    // Root path matches rootPath ('') — render the repo label, not a bare ".".
    const { isRoot, crumbs } = buildPathCrumbs('', ROOT);
    expect(isRoot).toBe(true);
    expect(crumbs).toEqual([{ label: 'codecity', segPath: '' }]);
  });

  it('treats "." as root for a directory', () => {
    const { isRoot, crumbs } = buildPathCrumbs('.', { ...ROOT, rootPath: '.' });
    expect(isRoot).toBe(true);
    expect(crumbs).toEqual([{ label: 'codecity', segPath: '.' }]);
  });

  it('does not treat a file whose path equals rootPath as root', () => {
    // A file (isDir false) is never the repo root even if the guard path lines up.
    const { isRoot, crumbs } = buildPathCrumbs('readme.md', {
      isDir: false,
      rootLabel: 'codecity',
      rootPath: '',
    });
    expect(isRoot).toBe(false);
    expect(crumbs).toEqual([{ label: 'readme.md', segPath: 'readme.md' }]);
  });

  it('drops empty segments from a trailing/leading slash', () => {
    const { crumbs } = buildPathCrumbs('/app/', { isDir: true, rootLabel: 'x', rootPath: '' });
    expect(crumbs).toEqual([{ label: 'app', segPath: 'app' }]);
  });
});

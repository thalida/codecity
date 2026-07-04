import { describe, it, expect } from 'vitest';
import { buildPathCrumbs } from '@/utils/pathCrumbs';
import { ROOT_PATH } from '@/constants/manifest';

const rootOpts = { isDir: true, rootLabel: 'codecity', rootPath: ROOT_PATH };

describe('buildPathCrumbs', () => {
  it('splits a nested path into cumulative segments', () => {
    const { isRoot, crumbs } = buildPathCrumbs('app/src/utils', rootOpts);
    expect(isRoot).toBe(false);
    expect(crumbs).toEqual([
      { label: 'app', segPath: 'app' },
      { label: 'src', segPath: 'app/src' },
      { label: 'utils', segPath: 'app/src/utils' },
    ]);
  });

  it('collapses the root directory to a single repo-label crumb', () => {
    // The selected dir's path equals rootPath (ROOT_PATH) — render the repo
    // label, not a bare "." segment.
    const { isRoot, crumbs } = buildPathCrumbs(ROOT_PATH, rootOpts);
    expect(isRoot).toBe(true);
    expect(crumbs).toEqual([{ label: 'codecity', segPath: ROOT_PATH }]);
  });

  it('does not treat a file whose path equals rootPath as root', () => {
    // A file (isDir false) is never the repo root even if the path lines up.
    const { isRoot, crumbs } = buildPathCrumbs('readme.md', {
      isDir: false,
      rootLabel: 'codecity',
      rootPath: ROOT_PATH,
    });
    expect(isRoot).toBe(false);
    expect(crumbs).toEqual([{ label: 'readme.md', segPath: 'readme.md' }]);
  });

  it('drops empty segments from a trailing/leading slash', () => {
    const { crumbs } = buildPathCrumbs('/app/', rootOpts);
    expect(crumbs).toEqual([{ label: 'app', segPath: 'app' }]);
  });
});

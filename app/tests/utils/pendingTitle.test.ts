import { describe, it, expect, beforeEach } from 'vitest';
import { applyPendingTitle } from '@/main';

// applyPendingTitle is called from main.ts's source-applying loop with the
// `display_root` field on the first cloning/scanning event the server emits.
// It sets document.title to "{label} (pending) — codecity" so the user sees
// the project name before the manifest arrives. Coordinator's title-swap
// (via labelFromManifest) takes over once the final manifest lands and the
// "(pending)" suffix is gone.
describe('applyPendingTitle', () => {
  beforeEach(() => {
    document.title = 'codecity';
  });

  it('sets "{label} (pending) — codecity" from a git URL display_root', () => {
    applyPendingTitle('https://github.com/owner/repo.git');
    expect(document.title).toBe('owner/repo (pending) — codecity');
  });

  it('handles local paths', () => {
    applyPendingTitle('/home/user/Repos/myproj');
    expect(document.title).toBe('myproj (pending) — codecity');
  });

  it('falls back to plain "codecity" if display_root is empty', () => {
    applyPendingTitle('');
    expect(document.title).toBe('codecity');
  });
});

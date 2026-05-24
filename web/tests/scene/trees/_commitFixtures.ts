// Test helper: build CommitEntry[] from terse `{date, files}` literals.
// Tests use this so per-test fixtures stay focused on the fields each
// case exercises (date + files) without re-stating the type shape.

import type { CommitEntry } from '@/types';

export function commits(...entries: CommitEntry[]): CommitEntry[] {
  return entries.map((e) => ({ ...e }));
}

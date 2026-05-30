// Test helper: build CommitEntry[] from terse `{date, files}` literals.
// Tests use this so per-test fixtures stay focused on the fields each
// case exercises (date + files) without re-stating the type shape.
// `authors`, `subject`, and `sha` are optional — sensible defaults are
// filled in when omitted so callers stay terse.

import type { CommitEntry } from '@/types';

export function commits(
  ...entries: (Omit<CommitEntry, 'sha' | 'authors' | 'subject'> & {
    sha?: string;
    authors?: string[];
    subject?: string;
  })[]
): CommitEntry[] {
  return entries.map((e, i) => ({
    authors: [`Author ${i}`],
    subject: `commit ${i}`,
    ...e,
    sha: e.sha ?? 'a'.repeat(40),
  }));
}

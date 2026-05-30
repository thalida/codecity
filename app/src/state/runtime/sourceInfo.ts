// state/runtime/sourceInfo.ts — Runtime signal holding the current source's
// display info: friendly label, branch name, and git URL. Written by the
// manifest-streaming logic in App.tsx after each successful source apply.
// Read by AppHeader to render the project chip + branch pill + repo link.

import { signal } from '@preact/signals';

export interface SourceInfo {
  /** Human-readable project label (owner/repo or directory name). */
  label: string;
  /** Branch name when the loaded source is a git URL with a known branch. */
  branch: string | undefined;
  /** Original git URL when the source is a hosted git repo. */
  sourceUrl: string | undefined;
}

export const SOURCE_INFO = signal<SourceInfo>({
  label: '',
  branch: undefined,
  sourceUrl: undefined,
});

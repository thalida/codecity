// components/sources/BranchPill/BranchPill.tsx — the "@branch" chip, wherever a repo is named: the
// header's switcher, a recents row, the loading header. Each of those wants a
// different truncation, so they add their own class rather than fork the pill.

import './BranchPill.css';
import type { ComponentChildren } from 'preact';

export interface BranchPillProps {
  branch: string;
  /** Extra class for the surface it sits on, e.g. its truncation rules. */
  class?: string;
  title?: string;
  /** Replaces the "@branch" text, for a surface that wraps it (SourceRow puts
   *  an inner span in so text-overflow has something to reach). */
  children?: ComponentChildren;
}

export function BranchPill({ branch, class: cls, title, children }: BranchPillProps) {
  return (
    <span class={cls ? `branch-pill ${cls}` : 'branch-pill'} title={title}>
      {children ?? `@${branch}`}
    </span>
  );
}

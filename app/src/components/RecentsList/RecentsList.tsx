// components/RecentsList/RecentsList.tsx — recent projects: a heading and the
// list. Active state matches each row against CURRENT_SOURCE by source identity
// (the canonical applied source, not the manifest's display fields): a local
// path is branch-less on both sides, so a checkout change never re-keys the row
// or drops its active badge. Remove is non-destructive: it forgets the entry
// only, it does not clear the scan cache (that's the skip-cache control's job).
// With no recents it renders the empty state rather than nothing: the tab is
// always offered, so a first visit learns that codecity remembers what you open.

import './RecentsList.css';
import { useState } from 'preact/hooks';
import { RECENTS, removeRecent, ACTIVE_SOURCE } from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverData';
import { srcKind, SourceKind, sourceIdentity, sameSourceIdentity } from '@/utils/sources';
import type { SourcePayload } from '@/types/ui';
import { RecentRow } from './RecentRow';

export interface RecentsListProps {
  onOpen: (payload: SourcePayload) => void;
}

export function RecentsList({ onOpen }: RecentsListProps) {
  const recents = RECENTS.value;
  const active = ACTIVE_SOURCE.value;
  const allowLocal = SERVER_CONFIG.value.allowLocalRepos;
  const [confirming, setConfirming] = useState<string | null>(null); // key of row

  const keyOf = (r: { src: string; branch?: string }) => sourceIdentity(r.src, r.branch);
  const isActive = (r: { src: string; branch?: string }) =>
    !!active && sameSourceIdentity(r, active);
  // A local recent while local repos are off can't load; still clickable (the
  // server error explains why), just flagged with a hint glyph.
  const isUnavailable = (r: { src: string }) => srcKind(r.src) === SourceKind.Local && !allowLocal;

  if (recents.length === 0) {
    return <p class="recents-empty">Projects you open will show up here.</p>;
  }

  return (
    <div class="source-list" data-list="recents">
      {recents.map((r) => (
        <RecentRow
          key={keyOf(r)}
          recent={r}
          active={isActive(r)}
          unavailable={isUnavailable(r)}
          confirmingRemove={confirming === keyOf(r)}
          onOpen={() => onOpen({ src: r.src, branch: r.branch })}
          onAskRemove={() => setConfirming(keyOf(r))}
          onCancelRemove={() => setConfirming(null)}
          onConfirmRemove={() => {
            removeRecent(r.src, r.branch);
            setConfirming(null);
          }}
        />
      ))}
    </div>
  );
}

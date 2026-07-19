// components/RecentsList/RecentsList.tsx — recent projects: a heading and the
// list. Active state matches each row against CURRENT_SOURCE by source identity
// (the canonical applied source, not the manifest's display fields): a local
// path is branch-less on both sides, so a checkout change never re-keys the row
// or drops its active badge. Remove is non-destructive: it forgets the entry
// only, it does not clear the scan cache (that's the skip-cache control's job).
// Renders nothing when there are no recents.

import './RecentsList.css';
import { useState } from 'preact/hooks';
import { listRecents, removeRecent, CURRENT_SOURCE, sourceIdentity } from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { srcKind, SourceKind } from '@/utils/sources';
import type { SourcePayload } from '@/state/stores/ui';
import { RecentRow } from './RecentRow';

export interface RecentsListProps {
  onOpen: (payload: SourcePayload) => void;
}

export function RecentsList({ onOpen }: RecentsListProps) {
  const recents = listRecents(); // reads RECENTS signal
  const cur = CURRENT_SOURCE.value;
  const allowLocal = SERVER_CONFIG.value.allowLocalRepos;
  const [confirming, setConfirming] = useState<string | null>(null); // key of row

  const keyOf = (r: { src: string; branch?: string }) => sourceIdentity(r.src, r.branch);
  const isActive = (r: { src: string; branch?: string }) =>
    !!cur && sourceIdentity(r.src, r.branch) === sourceIdentity(cur.src, cur.branch);
  // A local recent while local repos are off can't load; still clickable (the
  // server error explains why), just flagged with a hint glyph.
  const isUnavailable = (r: { src: string }) => srcKind(r.src) === SourceKind.Local && !allowLocal;

  if (recents.length === 0) return null;

  return (
    <div class="recents-list">
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

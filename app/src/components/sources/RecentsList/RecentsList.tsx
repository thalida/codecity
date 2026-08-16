// components/sources/RecentsList/RecentsList.tsx — recent projects. Rows match
// CURRENT_SOURCE by source identity, not the manifest's display fields, so a
// checkout change never drops a local path's active badge. Remove forgets the
// entry only; the scan cache is the skip-cache control's business.
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

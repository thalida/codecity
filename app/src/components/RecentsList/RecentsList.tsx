// components/RecentsList/RecentsList.tsx — recent projects: a heading and the
// list. Active state derives from SOURCE_INFO (the resolved branch, matching
// how recents store it — CURRENT_SOURCE keeps the raw submitted branch, which is
// undefined for a local repo whose recent carries its resolved HEAD).
// Remove is non-destructive: it forgets the entry only, it does not
// clear the scan cache (that's the skip-cache control's job). Renders nothing
// when there are no recents.

import './RecentsList.css';
import { useState } from 'preact/hooks';
import { listRecents, removeRecent, SOURCE_INFO } from '@/state/stores/source';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { srcKind, SourceKind } from '@/utils/sources';
import type { SourcePayload } from '@/state/stores/ui';
import { RecentRow } from './RecentRow';

export interface RecentsListProps {
  onOpen: (payload: SourcePayload) => void;
}

export function RecentsList({ onOpen }: RecentsListProps) {
  const recents = listRecents(); // reads RECENTS signal
  const si = SOURCE_INFO.value;
  const allowLocal = SERVER_CONFIG.value.allowLocalRepos;
  const [confirming, setConfirming] = useState<string | null>(null); // key of row

  const keyOf = (r: { src: string; branch?: string }) => `${r.src}:${r.branch ?? ''}`;
  const isActive = (r: { src: string; branch?: string }) =>
    !!si.src && r.src === si.src && (r.branch ?? '') === (si.branch ?? '');
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

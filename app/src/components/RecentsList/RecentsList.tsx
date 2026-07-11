// components/RecentsList/RecentsList.tsx — recent projects: a heading, a filter
// box, and the list. Active state derives from CURRENT_SOURCE (single source of
// truth, not the URL). Remove is non-destructive: it forgets the entry only, it
// does not clear the scan cache (that's the skip-cache control's job). Renders
// nothing when there are no recents at all.

import './RecentsList.css';
import { useMemo, useState } from 'preact/hooks';
import { listRecents, removeRecent, CURRENT_SOURCE } from '@/state/stores/source';
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
  const [filter, setFilter] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null); // key of row

  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      recents.filter(
        (r) => !q || r.label.toLowerCase().includes(q) || r.src.toLowerCase().includes(q)
      ),
    [recents, q]
  );

  const keyOf = (r: { src: string; branch?: string }) => `${r.src}:${r.branch ?? ''}`;
  const isActive = (r: { src: string; branch?: string }) =>
    !!cur && r.src === cur.src && (r.branch ?? '') === (cur.branch ?? '');
  // A local recent while local repos are off can't load; still clickable (the
  // server error explains why), just flagged with a hint glyph.
  const isUnavailable = (r: { src: string }) => srcKind(r.src) === SourceKind.Local && !allowLocal;

  if (recents.length === 0) return null;

  return (
    <div class="recents">
      <div class="recents-head">
        <h2 class="recents-title">Recent projects</h2>
        <input
          class="recents-filter form-input"
          type="text"
          aria-label="Filter recent projects"
          placeholder="Filter"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          autoComplete="off"
          spellcheck={false}
        />
      </div>
      {shown.length === 0 ? (
        <p class="recents-empty">No projects match your filter.</p>
      ) : (
        <div class="recents-list">
          {shown.map((r) => (
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
      )}
    </div>
  );
}

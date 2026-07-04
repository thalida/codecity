// views/ProjectsView/RecentsList.tsx — the recents hero: filter box + keyboard-
// navigable list. Active state derives from CURRENT_SOURCE (single source of
// truth, not the URL). Remove is non-destructive: it forgets the entry only,
// it does not clear the scan cache (that's the skip-cache control's job).

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
  const [cursor, setCursor] = useState(0);
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
  const isDisabled = (r: { src: string }) => srcKind(r.src) === SourceKind.Local && !allowLocal;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      const r = shown[cursor];
      if (r && !isActive(r) && !isDisabled(r)) onOpen({ src: r.src, branch: r.branch });
    }
  };

  if (recents.length === 0) return null;

  return (
    <div class="recents" onKeyDown={onKeyDown}>
      <input
        class="recents-filter"
        type="text"
        placeholder="Filter recent projects"
        value={filter}
        onInput={(e) => {
          setFilter((e.target as HTMLInputElement).value);
          setCursor(0);
        }}
        autoComplete="off"
        spellcheck={false}
      />
      <div class="recents-list" role="listbox">
        {shown.map((r, i) => (
          <RecentRow
            key={keyOf(r)}
            recent={r}
            active={isActive(r)}
            disabled={isDisabled(r)}
            highlighted={i === cursor}
            confirmingRemove={confirming === keyOf(r)}
            onOpen={() => {
              if (!isActive(r) && !isDisabled(r)) onOpen({ src: r.src, branch: r.branch });
            }}
            onAskRemove={() => setConfirming(keyOf(r))}
            onCancelRemove={() => setConfirming(null)}
            onConfirmRemove={() => {
              removeRecent(r.src, r.branch);
              setConfirming(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

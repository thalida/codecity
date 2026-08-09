// components/DiscoverList/DiscoverList.tsx — the curated repos worth rendering,
// as the same rows Recents uses: a Discover entry is a recent you haven't opened
// yet. No remove control (it isn't yours to forget) and no active badge (the
// active project is a recent by definition, so it shows up there).
//
// Deliberately no stars, timings or ordering signal. The list is hand-picked
// server-side, and anything numeric here would either rot or reopen an outbound
// dependency on a third party.

import './DiscoverList.css';
import { DISCOVER } from '@/state/stores/discover';
import { SourceRow } from '@/components/SourceRow/SourceRow';
import type { SourcePayload } from '@/state/stores/ui';

export interface DiscoverListProps {
  onOpen: (payload: SourcePayload) => void;
}

export function DiscoverList({ onOpen }: DiscoverListProps) {
  const repos = DISCOVER.value;
  if (repos.length === 0) return null;

  return (
    <div class="discover-list">
      {repos.map((repo) => (
        <div class="discover-item" key={repo.url}>
          <SourceRow src={repo.url} label={repo.label} onOpen={() => onOpen({ src: repo.url })} />
        </div>
      ))}
    </div>
  );
}

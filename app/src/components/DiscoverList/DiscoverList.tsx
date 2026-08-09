// components/DiscoverList/DiscoverList.tsx — the curated repos worth rendering,
// as the same rows Recents uses: a Discover entry is a recent you haven't opened
// yet, so it carries the same "Active" note when it is the project you have
// open. No remove control: it isn't yours to forget.
//
// Deliberately no stars, timings or ordering signal. The list is hand-picked
// server-side, and anything numeric here would either rot or reopen an outbound
// dependency on a third party.
//
// No "Featured" note either. Calling a repo featured while you're looking at a
// different one is noise about configuration; what a row can usefully say is
// whether it's the city you can see, and ACTIVE_SOURCE already answers that for
// the featured repo too.

import '@/components/SourceRow/SourceList.css';
import { DISCOVER } from '@/state/stores/discover';
import { ACTIVE_SOURCE } from '@/state/stores/source';
import { sameSourceIdentity } from '@/utils/sources';
import { SourceRow } from '@/components/SourceRow/SourceRow';
import type { SourcePayload } from '@/state/stores/ui';

export interface DiscoverListProps {
  onOpen: (payload: SourcePayload) => void;
}

export function DiscoverList({ onOpen }: DiscoverListProps) {
  const repos = DISCOVER.value;
  const active = ACTIVE_SOURCE.value;
  // Compared on src alone, branch dropped from both sides. A Discover row names
  // a repo, not a branch, so it is the one on screen whichever branch is loaded.
  // Recents rows do carry a branch and compare on full identity.
  if (repos.length === 0) return null;

  return (
    <div class="source-list" data-list="discover">
      {repos.map((repo) => (
        <div class="source-list-item" key={repo.url}>
          <SourceRow
            src={repo.url}
            label={repo.label}
            onOpen={() => onOpen({ src: repo.url })}
            active={!!active && sameSourceIdentity({ src: repo.url }, { src: active.src })}
          />
        </div>
      ))}
    </div>
  );
}

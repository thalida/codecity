// components/sources/DiscoverList/DiscoverList.tsx — the curated repos, as the
// rows Recents uses: a Discover entry is a recent you have not opened yet. No
// stars or timings, which would rot or reopen a third-party dependency, and no
// "Featured" note, since what a row can usefully say is whether you can see it.
import { DISCOVER } from '@/state/stores/serverData';
import { ACTIVE_SOURCE } from '@/state/stores/source';
import { sameSourceIdentity } from '@codecity/city';
import { SourceRow } from '@/components/sources/SourceRow/SourceRow';
import { cityHref } from '@/router/location';

export function DiscoverList() {
  const repos = DISCOVER.value;
  const active = ACTIVE_SOURCE.value;
  // src alone: a Discover row names a repo, not a branch, so it is the one on
  // screen whichever branch is loaded. Recents compare on full identity.
  if (repos.length === 0) return null;

  return (
    <div class="source-list" data-list="discover">
      {repos.map((repo) => (
        <div class="source-list-item" key={repo.url}>
          <SourceRow
            src={repo.url}
            label={repo.label}
            href={cityHref(repo.url)}
            active={!!active && sameSourceIdentity({ src: repo.url }, { src: active.src })}
          />
        </div>
      ))}
    </div>
  );
}

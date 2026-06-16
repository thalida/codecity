// views/InfoPane/WorldPane.tsx — the "World" subtab: a travel-guide of repo
// superlatives derived by computeAlmanac. Landmark rows fly the camera to that
// building/tree. Body-only — InfoPane owns the Pane chrome.

import './WorldPane.css';
import { useMemo } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { FolderOpen } from 'lucide-preact';
import type { DirNode, Manifest } from '@/types';
import { PaneEmpty } from '@/components/Pane';
import { selectPath, focusPath, selectCommit, focusCommit } from '@/state/stores/scene';
import { TREES } from '@/state/stores/settings/trees';
import { computeAlmanac, fmtCount } from './almanac';
import type { AlmanacFact, LandmarkRef } from './almanac';

function visit(landmark: LandmarkRef): void {
  if (landmark.kind === 'commit') {
    selectCommit(landmark.id);
    focusCommit(landmark.id);
  } else {
    selectPath(landmark.id);
    focusPath(landmark.id);
  }
}

function FactBody({ fact }: { fact: AlmanacFact }) {
  return (
    <>
      <span class="almanac-fact-label">{fact.label}</span>
      <span class="almanac-fact-body">
        <span
          class={fact.mono ? 'almanac-fact-primary almanac-fact-primary--mono' : 'almanac-fact-primary'}
        >
          {fact.primary}
        </span>
        {fact.secondary && <span class="almanac-fact-secondary">{fact.secondary}</span>}
      </span>
    </>
  );
}

function FactRow({ fact }: { fact: AlmanacFact }) {
  if (fact.landmark) {
    const landmark = fact.landmark;
    return (
      <button
        type="button"
        class="almanac-fact almanac-fact--landmark"
        title={`${fact.primary} — fly here`}
        onClick={() => visit(landmark)}
      >
        <FactBody fact={fact} />
      </button>
    );
  }
  return (
    <div class="almanac-fact">
      <FactBody fact={fact} />
    </div>
  );
}

export interface WorldPaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
}

export function WorldPane({ manifest }: WorldPaneProps) {
  const current = manifest.value;
  const almanac = useMemo(() => computeAlmanac(current as Manifest | DirNode | null), [current]);

  if (!almanac) {
    return <PaneEmpty icon={FolderOpen} title="No project loaded" sub="Open one to explore its world." />;
  }

  const { overview, sections } = almanac;
  // Forest landmarks (canopies) fly the camera to a tree; when the Trees layer
  // is off those targets don't exist, so gate the section's contents on it.
  const treesEnabled = TREES.value.ENABLED;
  return (
    <div class="almanac">
      <header class="almanac-overview">
        <h2 class="almanac-name">{overview.name}</h2>
        <p class="almanac-blurb">
          {overview.founded ? `Founded ${overview.founded}, ` : ''}
          this city of {fmtCount(overview.totals.files)} buildings sprawls across{' '}
          {fmtCount(overview.totals.dirs)} districts
          {overview.totals.authors > 0
            ? `, tended by ${fmtCount(overview.totals.authors)} fireflies`
            : ''}
          .
        </p>
        <dl class="almanac-meta">
          {overview.repo.branch && (
            <div><dt>Branch</dt><dd>{overview.repo.branch}</dd></div>
          )}
          {overview.repo.remote_url && (
            <div><dt>Remote</dt><dd><a href={overview.repo.remote_url} target="_blank" rel="noreferrer">{overview.repo.remote_url}</a></dd></div>
          )}
          {overview.repo.head_subject && (
            <div><dt>Latest</dt><dd>{overview.repo.head_subject}{overview.repo.dirty ? ' (uncommitted changes)' : ''}</dd></div>
          )}
        </dl>
        {overview.languages.length > 0 && (
          <ul class="almanac-languages">
            {overview.languages.map((l) => (
              <li key={l.ext}><span class="almanac-lang-ext">{l.ext}</span> {fmtCount(l.count)}</li>
            ))}
          </ul>
        )}
      </header>
      {sections.map((s) => (
        <section key={s.key} class="almanac-section">
          <h3 class="almanac-section-title">{s.title}</h3>
          {s.key === 'forest' && !treesEnabled ? (
            <p class="almanac-section-note">Enable the Trees layer in Settings to explore the forest.</p>
          ) : (
            s.facts.map((f, i) => <FactRow key={i} fact={f} />)
          )}
        </section>
      ))}
    </div>
  );
}

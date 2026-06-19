// views/InfoPane/WorldPane.tsx — the "World" subtab: a travel-guide of repo
// superlatives derived by computeAlmanac. A focus button on each landmark row
// flies the camera to that building/tree. Body-only — InfoPane owns the chrome.

import './WorldPane.css';
import { useMemo } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { FolderOpen, Focus } from 'lucide-preact';
import type { DirNode, Manifest } from '@/types';
import { PaneEmpty } from '@/components/Pane';
import { ExtensionBadge } from '@/components/Badge/Badge';
import { selectPath, focusPath, selectCommit, focusCommit } from '@/state/stores/scene';
import { TREES } from '@/state/stores/settings/trees';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { STREETS } from '@/state/stores/settings/streets';
import { commitUrl } from '@/utils/commit';
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

/** Path values keep the filename fully visible and truncate the directory from
 *  the right; shas / dates / names (no slash) render as-is. */
function PrimaryValue({ fact }: { fact: AlmanacFact }) {
  if (!fact.mono) return <span class="almanac-fact-primary">{fact.primary}</span>;
  const slash = fact.primary.lastIndexOf('/');
  if (slash < 0) {
    return <span class="almanac-fact-primary almanac-fact-primary--mono">{fact.primary}</span>;
  }
  return (
    <span class="almanac-fact-primary almanac-fact-primary--mono">
      <span class="almanac-path-dir">{fact.primary.slice(0, slash + 1)}</span>
      <span class="almanac-path-base">{fact.primary.slice(slash + 1)}</span>
    </span>
  );
}

function FactRow({ fact }: { fact: AlmanacFact }) {
  const landmark = fact.landmark;
  return (
    <div class="almanac-fact">
      <span class="almanac-fact-label">{fact.label}</span>
      <div class="almanac-fact-body">
        <PrimaryValue fact={fact} />
        {fact.secondary && <span class="almanac-fact-secondary">{fact.secondary}</span>}
        {landmark && (
          <button
            type="button"
            class="btn-icon almanac-fact-focus"
            title="Focus in the world"
            aria-label={`Focus ${fact.primary} in the world`}
            onClick={() => visit(landmark)}
          >
            <Focus class="lucide-icon" />
          </button>
        )}
      </div>
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
  const { repo } = overview;
  // Forest landmarks (canopies) fly the camera to a tree; when the Trees layer
  // is off those targets don't exist, so gate the section's contents on it.
  const treesEnabled = TREES.value.ENABLED;
  const huePalette = BUILDINGS.value.HUE_EXT_MAP;
  const asphaltColor = STREETS.value.ASPHALT_COLOR;
  const latestUrl = repo.remote_url && repo.head_sha ? commitUrl(repo.remote_url, repo.head_sha) : null;

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
          {repo.branch && (
            <div>
              <dt>Branch</dt>
              <dd>{repo.branch}</dd>
            </div>
          )}
          {repo.remote_url && (
            <div>
              <dt>Remote</dt>
              <dd>
                <a href={repo.remote_url} target="_blank" rel="noreferrer">
                  {repo.remote_url}
                </a>
              </dd>
            </div>
          )}
          {repo.head_sha && repo.head_subject && (
            <div>
              <dt>Latest</dt>
              <dd>
                {latestUrl ? (
                  <a href={latestUrl} target="_blank" rel="noreferrer" title={repo.head_subject}>
                    <span class="almanac-sha">{repo.head_sha.slice(0, 7)}</span> {repo.head_subject}
                  </a>
                ) : (
                  <>
                    <span class="almanac-sha">{repo.head_sha.slice(0, 7)}</span> {repo.head_subject}
                  </>
                )}
                {repo.dirty ? ' (uncommitted changes)' : ''}
              </dd>
            </div>
          )}
        </dl>
        {overview.languages.length > 0 && (
          <ul class="almanac-languages">
            {overview.languages.map((l) => (
              <li key={l.ext} class="almanac-language">
                <ExtensionBadge
                  extension={l.ext === '(none)' ? null : l.ext}
                  isDir={false}
                  huePalette={huePalette}
                  asphaltColor={asphaltColor}
                />
                <span class="almanac-language-count">{fmtCount(l.count)}</span>
              </li>
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

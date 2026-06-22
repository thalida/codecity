// views/InfoPane/OverviewPane.tsx — the "Overview" subtab: a travel-guide of
// repo superlatives derived by computeAlmanac. Each section reads as a legend
// for one world layer (icon + accent); min↔max facts render as bound duos, and
// a landmark row is itself the button that flies the camera there. Body-only —
// InfoPane owns the chrome.

import './OverviewPane.css';
import { useMemo } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { FolderOpen, Focus, Building2, Image, Signpost, TreePine, Sparkles } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { NodeKind } from '@/types';
import type { DirNode, Manifest } from '@/types';
import { PaneEmpty } from '@/components/Pane';
import { ExtensionBadge } from '@/components/Badge/Badge';
import { selectPath, focusPath, selectCommit, focusCommit } from '@/state/stores/scene';
import { TREES } from '@/state/stores/settings/trees';
import { commitUrl } from '@/utils/commit';
import { formatCount } from '@/utils/format';
import { computeAlmanac } from './almanac';
import type { AlmanacFact, AlmanacSectionKey, LandmarkRef } from './almanac';

// Each section gets its world layer's icon — the panel reads as a legend for
// the city, not a generic stats list. The accent color is keyed off
// data-section in the CSS so it stays a single source of truth.
const SECTION_ICON: Record<AlmanacSectionKey, LucideIcon> = {
  buildings: Building2,
  media: Image,
  streets: Signpost,
  forest: TreePine,
  fireflies: Sparkles,
};

function visit(landmark: LandmarkRef): void {
  if (landmark.kind === NodeKind.Commit) {
    selectCommit(landmark.id);
    focusCommit(landmark.id);
  } else {
    selectPath(landmark.id);
    focusPath(landmark.id);
  }
}

/** Collapse a section's flat fact list into render groups: consecutive facts
 *  sharing a `group` become one bound duo; everything else is a solo group. */
function groupFacts(facts: AlmanacFact[]): { dimension?: string; facts: AlmanacFact[] }[] {
  const out: { dimension?: string; facts: AlmanacFact[] }[] = [];
  for (const f of facts) {
    const last = out[out.length - 1];
    if (f.group && last && last.dimension === f.group) last.facts.push(f);
    else out.push({ dimension: f.group, facts: [f] });
  }
  return out;
}

/** Landmark facts have a code-identifier primary (path or sha) → render
 *  monospace; a path additionally keeps its filename visible and truncates the
 *  directory from the left. Plain summary facts (no landmark) render as-is. */
function PrimaryValue({ fact }: { fact: AlmanacFact }) {
  if (!fact.landmark) return <span class="almanac-fact-primary">{fact.primary}</span>;
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

/** One fact row: label · value · right-aligned metric. A landmark fact is the
 *  whole row — a button that flies the camera (focus glyph revealed on hover);
 *  a summary fact is a plain, non-interactive row. */
function FactRow({ fact }: { fact: AlmanacFact }) {
  const landmark = fact.landmark;
  const inner = (
    <>
      {fact.label && <span class="almanac-fact-label">{fact.label}</span>}
      <PrimaryValue fact={fact} />
      {fact.secondary && <span class="almanac-fact-metric">{fact.secondary}</span>}
      {landmark && <Focus class="lucide-icon almanac-fact-focus" aria-hidden="true" />}
    </>
  );
  if (!landmark) {
    return (
      <div class="almanac-fact" title={fact.tip}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      class="almanac-fact almanac-fact--nav"
      title={fact.tip}
      aria-label={`Focus ${fact.primary} in the world`}
      onClick={() => visit(landmark)}
    >
      {inner}
    </button>
  );
}

/** A section's facts: bound min↔max duos under a dimension label, solo facts
 *  plain. The accent that binds a duo comes from the section's data-section. */
function SectionBody({ facts }: { facts: AlmanacFact[] }) {
  return (
    <>
      {groupFacts(facts).map((g, i) =>
        g.dimension ? (
          <div key={i} class="almanac-duo">
            <span class="almanac-duo-dim">{g.dimension}</span>
            {g.facts.map((f, j) => (
              <FactRow key={j} fact={f} />
            ))}
          </div>
        ) : (
          <FactRow key={i} fact={g.facts[0]} />
        )
      )}
    </>
  );
}

export interface OverviewPaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
}

export function OverviewPane({ manifest }: OverviewPaneProps) {
  const current = manifest.value;
  // The Forest section's contents depend on whether the Trees layer is on, so
  // it's a compute input — the section's notice comes back as an empty state.
  const treesEnabled = TREES.value.ENABLED;
  const almanac = useMemo(
    () => computeAlmanac(current as Manifest | DirNode | null, treesEnabled),
    [current, treesEnabled]
  );

  if (!almanac) {
    return (
      <PaneEmpty icon={FolderOpen} title="No project loaded" sub="Open one to explore its world." />
    );
  }

  const { overview, sections } = almanac;
  const { repo } = overview;
  const latestUrl =
    repo.remote_url && repo.head_sha ? commitUrl(repo.remote_url, repo.head_sha) : null;

  return (
    <div class="almanac">
      <header class="almanac-overview">
        <h2 class="almanac-name">{overview.name}</h2>
        <p class="almanac-blurb">
          {overview.founded ? `Founded ${overview.founded}, ` : ''}
          this city of {formatCount(overview.totals.files)} buildings sprawls across{' '}
          {formatCount(overview.totals.dirs)} districts
          {overview.totals.authors > 0
            ? `, tended by ${formatCount(overview.totals.authors)} fireflies`
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
              </dd>
            </div>
          )}
        </dl>
        {overview.languages.length > 0 && (
          <ul class="almanac-languages">
            {overview.languages.map((l) => (
              <li key={l.ext} class="almanac-language">
                <ExtensionBadge extension={l.ext === '(none)' ? null : l.ext} isDir={false} />
                <span class="almanac-language-count">{formatCount(l.count)}</span>
              </li>
            ))}
            {overview.moreLanguages > 0 && (
              <li
                class="almanac-language almanac-language--more"
                title={`${formatCount(overview.moreLanguageFiles)} more files across ${overview.moreLanguages} other file ${overview.moreLanguages === 1 ? 'type' : 'types'}`}
              >
                +{formatCount(overview.moreLanguages)} more
              </li>
            )}
          </ul>
        )}
      </header>
      {sections.map((s) => {
        const Icon = SECTION_ICON[s.key];
        return (
          <section key={s.key} class="almanac-section" data-section={s.key}>
            <h3 class="almanac-section-title" title={s.tip}>
              <Icon class="lucide-icon almanac-section-icon" aria-hidden="true" />
              {s.title}
            </h3>
            {s.facts.length > 0 ? (
              <>
                <p class="almanac-section-overview">{s.overview}</p>
                <SectionBody facts={s.facts} />
              </>
            ) : (
              <p class="almanac-section-note">{s.note}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

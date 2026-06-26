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
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { getHue } from '@/city/components/buildings/color';
import { humanAge, formatRelativeAge } from '@/utils/dates';
import { languageLabelForExt } from '@/utils/syntaxLanguages';
import { formatCount, pluralize } from '@/utils/format';
import { computeAlmanac } from './almanac';
import type { AlmanacFact, AlmanacSectionKey, LandmarkRef, LanguageStat } from './almanac';

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

/** "A"/"An" for an age phrase ("8-year-old" → "An"), keyed on the spoken sound
 *  of its leading number. Vowel-sound starts in the realistic age range: 8, 11,
 *  18, and the eighties. */
function articleFor(age: string): 'A' | 'An' {
  const n = parseInt(age, 10);
  return n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'An' : 'A';
}

/** A flavor one-liner weaving the city's age, scale, and dominant language into
 *  one sentence ("An 8-year-old city of 312 buildings, mostly Python.") — enough
 *  texture to set the scene, without the per-layer counts (those live in each
 *  section's overview). Each clause drops out when its input is absent; empty
 *  when the repo has nothing to say. */
export function flavorBlurb(age: string, buildings: number, language: string | null): string {
  if (!age && !buildings && !language) return '';
  let s = age ? `${articleFor(age)} ${age} city` : 'A city';
  if (buildings > 0) s += ` of ${pluralize(buildings, 'building')}`;
  if (language) s += `, mostly ${language}`;
  return `${s}.`;
}

/** GitHub-style stacked composition bar: one segment per top language (width ∝
 *  file count, painted with the same extension→hue the city and the legend chips
 *  use), plus a neutral tail for everything past the top few. The chips below it
 *  read as its legend. */
function LanguageBar({
  languages,
  moreLanguages,
  moreFiles,
}: {
  languages: LanguageStat[];
  moreLanguages: number;
  moreFiles: number;
}) {
  const palette = BUILDINGS.value.HUE_EXT_MAP;
  const total = languages.reduce((sum, l) => sum + l.count, 0) + moreFiles;
  if (total <= 0) return null;
  const share = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div class="almanac-langbar" aria-hidden="true">
      {languages.map((l) => {
        const name = languageLabelForExt(l.ext) ?? (l.ext === '(none)' ? 'No extension' : l.ext);
        return (
          <span
            key={l.ext}
            class="almanac-langbar-seg"
            title={`${name} · ${pluralize(l.count, 'file')} (${share(l.count)})`}
            style={{
              width: share(l.count),
              // Match ExtensionBadge: the "(none)" sentinel hues off '' like its chip.
              background: `hsl(${getHue(l.ext === '(none)' ? '' : l.ext, palette)}, 60%, 35%)`,
            }}
          />
        );
      })}
      {moreFiles > 0 && (
        <span
          class="almanac-langbar-seg almanac-langbar-seg--more"
          title={`${pluralize(moreFiles, 'file')} across ${pluralize(moreLanguages, 'other file type')} (${share(moreFiles)})`}
          style={{ width: share(moreFiles) }}
        />
      )}
    </div>
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
  // Live age against the current clock ("2-year-old") for the flavor blurb.
  const age = overview.foundedISO ? humanAge(overview.foundedISO, new Date().toISOString()) : '';
  const blurb = flavorBlurb(age, overview.buildings, overview.topLanguage);
  // The HEAD commit, if any — the "Latest" row flies the camera to its tree.
  const head =
    repo.head_sha && repo.head_subject
      ? { sha: repo.head_sha.slice(0, 7), full: repo.head_sha, subject: repo.head_subject }
      : null;
  const latestAgo = overview.latestDate ? formatRelativeAge(overview.latestDate) : null;
  // The Latest row only flies the camera when the Trees layer is on — without it
  // the commit's tree doesn't exist, so a clickable button would be a dead end
  // (the Forest section gates its commit rows the same way).
  const latestBody = head && (
    <>
      <span class="almanac-latest-head">
        <span class="almanac-sha">{head.sha}</span>
        <span class="almanac-latest-subject">{head.subject}</span>
      </span>
      {(latestAgo || repo.branch) && (
        <span class="almanac-latest-sub">
          {latestAgo && <span>{latestAgo}</span>}
          {repo.branch && <span class="almanac-branch">{repo.branch}</span>}
        </span>
      )}
    </>
  );

  return (
    <div class="almanac">
      <header class="almanac-overview">
        <h2 class="almanac-name">{overview.name}</h2>
        {blurb && <p class="almanac-blurb">{blurb}</p>}
        <dl class="almanac-meta">
          {overview.founded && (
            <div>
              <dt>Founded</dt>
              <dd>{overview.founded}</dd>
            </div>
          )}
          {head && (
            <div>
              <dt>Latest</dt>
              <dd class="almanac-latest-cell">
                {treesEnabled ? (
                  <button
                    type="button"
                    class="almanac-latest"
                    title={head.subject}
                    aria-label={`Focus the latest commit ${head.sha} in the world`}
                    onClick={() => visit({ kind: NodeKind.Commit, id: head.full })}
                  >
                    {latestBody}
                  </button>
                ) : (
                  <div class="almanac-latest" title={head.subject}>
                    {latestBody}
                  </div>
                )}
              </dd>
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
        </dl>
        {overview.languages.length > 0 && (
          <>
            <LanguageBar
              languages={overview.languages}
              moreLanguages={overview.moreLanguages}
              moreFiles={overview.moreLanguageFiles}
            />
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
          </>
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

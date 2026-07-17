// views/InfoPane/OverviewPane.tsx — the "Overview" subtab: a travel-guide of
// repo superlatives derived by computeAlmanac. The pane leads with a one-line
// descriptor, then a section per world layer (icon + accent); min↔max facts
// render as bound duos, and a landmark row is itself the button that flies the
// camera there. Body-only — InfoPane owns the chrome.

import './OverviewPane.css';
import { useMemo } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { FolderOpen, Focus } from 'lucide-preact';
import { NodeKind } from '@/types';
import type { DirNode, Manifest } from '@/types';
import { PaneEmpty } from '@/components/Pane';
import { selectPath, focusPath, selectCommit, focusCommit } from '@/state/stores/scene';
import { TREES } from '@/state/stores/settings/trees';
import { computeAlmanac } from './almanac';
import type { AlmanacFact, LandmarkRef } from './almanac';
import { SECTION_ICON } from './sectionIcons';

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
      {landmark && <Focus class="icon almanac-fact-focus" aria-hidden="true" />}
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
            <span class="almanac-duo-dim text-label">{g.dimension}</span>
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

  const { sections } = almanac;

  return (
    <div class="almanac pane-inset">
      <p class="almanac-intro">A guided tour of the city&apos;s landmarks.</p>
      {sections.map((s) => {
        const Icon = SECTION_ICON[s.key];
        return (
          <section key={s.key} class="almanac-section" data-section={s.key}>
            <h3 class="almanac-section-title text-label" title={s.tip}>
              <Icon class="icon almanac-section-icon" aria-hidden="true" />
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

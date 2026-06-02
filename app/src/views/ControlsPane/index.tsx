// views/ControlsPane/index.tsx — "Controls" tab in the left sidebar.
//
// Composition shell. The body content lives in per-section components
// under ./controls/; this file just lays out the section order and the
// sticky action bar.
//
// Layout:
//   .controls-pane (flex column)
//     .pane-header     — shared header (title + × close) via PaneHeader
//     .controls-body   — scrollable column of sections
//     ActionsBar       — sticky bottom: Reset all (left) · Discard · Save (right)
//
// Per-row affordance: every input mutates a single in-memory draft
// layer (state/settingsDrafts.ts). Save commits drafts to the real signals,
// which triggers the existing reaction effects (applyTheme or
// world.applyManifest). Discard clears drafts without touching
// signals. Section / collapsible-subgroup open state is intentionally
// NOT persisted — the `collapsed` prop (driven by the sidebar's collapsed
// state) collapses every <details> when the panel is hidden, so it always
// reopens fresh.

import { useEffect, useRef } from 'preact/hooks';
import { ShortcutsSection } from './partials/ShortcutsSection';

import { FilePreviewSection } from './partials/FilePreviewSection';
import { DebugSection } from './partials/DebugSection';
import { DynamicSection, type SectionNode } from './partials';
import { TREES_SECTION } from './partials/Trees';
import { EFFECTS_SECTION } from './partials/Effects';
import { FIREFLIES_SECTION } from './partials/Fireflies';
import { UPDATES_SECTION } from './partials/Updates';
import { ISLAND_SECTION } from './partials/Island';
import { SCENE_SECTION } from './partials/Scene';
import { GEM_SECTION } from './partials/Gem';
import { STREETS_SECTION } from './partials/Streets';
import { FOOTPRINT_SECTION } from './partials/Footprint';
import { BUILDINGS_SECTION } from './partials/Buildings';
import { ActionsBar } from './ActionsBar';
import { Pane } from '@/components/Pane';

export interface ControlsPaneProps {
  onClose?: () => void;
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
  /** When true the panel is hidden (sidebar collapsed). On that transition we
   *  collapse every section so the panel reopens fresh — section open-state is
   *  intentionally not persisted across opens. Declarative: the parent just
   *  passes its collapsed state; no imperative reset call. */
  collapsed?: boolean;
}

export function ControlsPane({
  onClose,
  onRunCollisionCheck,
  onRunStemDiagnostic,
  collapsed,
}: ControlsPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed || !paneRef.current) return;
    paneRef.current.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => {
      d.open = false;
    });
  }, [collapsed]);

  // Top-level section order. Schema-driven sections are SectionNodes (rendered
  // by DynamicSection); not-yet-migrated ones are bespoke components carried as
  // `render`. As each section is converted its entry flips from a render shim
  // to its imported *_SECTION node. (DebugSection stays a render entry — it
  // needs the run-* callbacks passed down here.)
  const sections: SectionNode[] = [
    { key: 'shortcuts', render: <ShortcutsSection /> },
    UPDATES_SECTION,
    SCENE_SECTION,
    ISLAND_SECTION,
    BUILDINGS_SECTION,
    STREETS_SECTION,
    FOOTPRINT_SECTION,
    GEM_SECTION,
    TREES_SECTION,
    FIREFLIES_SECTION,
    EFFECTS_SECTION,
    { key: 'file-preview', render: <FilePreviewSection /> },
    {
      key: 'debug',
      render: (
        <DebugSection
          onRunCollisionCheck={onRunCollisionCheck}
          onRunStemDiagnostic={onRunStemDiagnostic}
        />
      ),
    },
  ];

  return (
    <Pane
      paneClass="controls-pane"
      title="Settings"
      onClose={onClose}
      bodyClass="pane-body--padded"
      footerSlot={<ActionsBar />}
      paneRef={paneRef}
    >
      {sections.map((node) => (
        <DynamicSection key={node.key} node={node} />
      ))}
    </Pane>
  );
}

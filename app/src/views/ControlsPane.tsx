// views/ControlsPane.tsx — "Controls" tab in the left sidebar.
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
// layer (state/drafts.ts). Save commits drafts to the real signals,
// which triggers the existing reaction effects (applyTheme or
// world.applyManifest). Discard clears drafts without touching
// signals. Section / collapsible-subgroup open state is intentionally
// NOT persisted — the `collapsed` prop (driven by the sidebar's collapsed
// state) collapses every <details> when the panel is hidden, so it always
// reopens fresh.

import { useEffect, useRef } from 'preact/hooks';
import { ShortcutsSection } from './controls/ShortcutsSection';

import { FilePreviewSection } from './controls/FilePreviewSection';
import { DebugSection } from './controls/DebugSection';
import { DynamicSection, type SectionNode } from './controls/sections';
import { TREES_SECTION } from './controls/sections/trees';
import { EFFECTS_SECTION } from './controls/sections/effects';
import { FIREFLIES_SECTION } from './controls/sections/fireflies';
import { UPDATES_SECTION } from './controls/sections/updates';
import { ISLAND_SECTION } from './controls/sections/island';
import { SCENE_SECTION } from './controls/sections/scene';
import { GEM_SECTION } from './controls/sections/gem';
import { STREETS_SECTION } from './controls/sections/streets';
import { FOOTPRINT_SECTION } from './controls/sections/footprint';
import { BUILDINGS_SECTION } from './controls/sections/buildings';
import { ActionsBar } from './controls/ActionsBar';
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

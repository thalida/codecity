// views/panes/ControlsPane.tsx — "Controls" tab in the left sidebar.
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
import { UpdatesSection } from './controls/UpdatesSection';
import { SceneSection } from './controls/SceneSection';
import { IslandSection } from './controls/IslandSection';
import { BuildingsSection } from './controls/BuildingsSection';
import { StreetsSection } from './controls/StreetsSection';
import { GemSection } from './controls/GemSection';
import { GeneratedSection, TREES_SECTION } from './controls/sections';
import { FirefliesSection } from './controls/FirefliesSection';
import { EffectsSection } from './controls/EffectsSection';
import { FilePreviewSection } from './controls/FilePreviewSection';
import { DebugSection } from './controls/DebugSection';
import { ActionsBar } from './controls/ActionsBar';
import { Pane } from '@/views/components/Pane';

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

  return (
    <Pane
      paneClass="controls-pane"
      title="Settings"
      onClose={onClose}
      bodyClass="pane-body--padded"
      footerSlot={<ActionsBar />}
      paneRef={paneRef}
    >
      <ShortcutsSection />
      <UpdatesSection />
      <SceneSection />
      <IslandSection />
      <BuildingsSection />
      <StreetsSection />
      <GemSection />
      <GeneratedSection node={TREES_SECTION} />
      <FirefliesSection />
      <EffectsSection />
      <FilePreviewSection />
      <DebugSection
        onRunCollisionCheck={onRunCollisionCheck}
        onRunStemDiagnostic={onRunStemDiagnostic}
      />
    </Pane>
  );
}

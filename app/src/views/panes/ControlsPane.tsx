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
// NOT persisted — `resetCollapsed()` (called by the left sidebar
// whenever the Controls tab becomes visible) collapses every <details>
// so the panel always opens fresh.

import { render } from 'preact';
import { useImperativeHandle, useRef } from 'preact/hooks';
import type { Ref } from 'preact';
import { ShortcutsSection } from './controls/ShortcutsSection';
import { UpdatesSection } from './controls/UpdatesSection';
import { SceneSection } from './controls/SceneSection';
import { IslandSection } from './controls/IslandSection';
import { BuildingsSection } from './controls/BuildingsSection';
import { StreetsSection } from './controls/StreetsSection';
import { GemSection } from './controls/GemSection';
import { TreesSection } from './controls/TreesSection';
import { FirefliesSection } from './controls/FirefliesSection';
import { EffectsSection } from './controls/EffectsSection';
import { FilePreviewSection } from './controls/FilePreviewSection';
import { DebugSection } from './controls/DebugSection';
import { ActionsBar } from './controls/ActionsBar';
import { PaneHeader } from '@/views/components/PaneHeader';

export interface ControlsPaneApi {
  /** Collapse every <details> inside the pane. Called by the left
   *  sidebar when the Controls tab becomes visible so the panel
   *  always opens fresh — no state memory between opens. */
  resetCollapsed: () => void;
}

export interface ControlsPaneProps {
  onClose?: () => void;
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
  apiRef?: Ref<ControlsPaneApi | null>;
}

export function ControlsPane({
  onClose,
  onRunCollisionCheck,
  onRunStemDiagnostic,
  apiRef,
}: ControlsPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    apiRef,
    () => ({
      resetCollapsed() {
        if (!paneRef.current) return;
        paneRef.current
          .querySelectorAll<HTMLDetailsElement>('details')
          .forEach((d) => {
            d.open = false;
          });
      },
    }),
    []
  );

  return (
    <div ref={paneRef} class="pane controls-pane">
      <PaneHeader title="Settings" onClose={onClose} />
      <div class="pane-body pane-body--padded">
        <ShortcutsSection />
        <UpdatesSection />
        <SceneSection />
        <IslandSection />
        <BuildingsSection />
        <StreetsSection />
        <GemSection />
        <TreesSection />
        <FirefliesSection />
        <EffectsSection />
        <FilePreviewSection />
        <DebugSection
          onRunCollisionCheck={onRunCollisionCheck}
          onRunStemDiagnostic={onRunStemDiagnostic}
        />
      </div>
      <ActionsBar />
    </div>
  );
}

// ── Imperative shim ───────────────────────────────────────────────────
// LeftSidebar still mounts panes by appending HTMLElements (#35 will
// port that path to Preact, after which this shim can be deleted per
// #10). buildControlsPane returns an element ready to be appended into
// the sidebar's pane slot, plus a hook to collapse every <details>.
//
// Internally it renders <ControlsPane /> into the returned element via
// Preact's render() — every section + widget is real Preact, no
// imperative DOM building anywhere.

export interface BuildControlsPaneOpts {
  onClose?: () => void;
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export interface ControlsPaneBundle {
  pane: HTMLElement;
  resetCollapsed: () => void;
}

export function buildControlsPane(opts: BuildControlsPaneOpts = {}): ControlsPaneBundle {
  // Preact's render() always mounts the component as a child of the
  // container, so we render into a throwaway host and return the
  // component's outer element (host.firstElementChild) — which IS the
  // `.pane.controls-pane` div produced by <ControlsPane />.
  const host = document.createElement('div');
  const apiRef: { current: ControlsPaneApi | null } = { current: null };
  render(
    <ControlsPane
      onClose={opts.onClose}
      onRunCollisionCheck={opts.onRunCollisionCheck}
      onRunStemDiagnostic={opts.onRunStemDiagnostic}
      apiRef={apiRef}
    />,
    host
  );
  const pane = host.firstElementChild as HTMLElement;
  return {
    pane,
    resetCollapsed() {
      apiRef.current?.resetCollapsed();
    },
  };
}

// views/InfoPane.tsx — "Info" tab in the left sidebar. Shows the
// rendered markdown of the project's root README (if any) — README.md,
// README.markdown, README, etc. Re-fetches and re-renders whenever the
// manifest is re-applied (which happens on live-update polling), so an
// edit to the README on disk shows up here without a page reload.

import './InfoPane.css';
import type { Signal } from '@preact/signals';
import type { DirNode, Manifest } from '@/types';
import { Pane } from '@/components/Pane';
import { ReadmePane } from './ReadmePane';

export interface InfoPaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
  onClose?: () => void;
}

export function InfoPane({ manifest, onClose }: InfoPaneProps) {
  return (
    <Pane paneClass="info-pane" title="Info" onClose={onClose} bodyClass="info-body">
      <ReadmePane manifest={manifest} />
    </Pane>
  );
}

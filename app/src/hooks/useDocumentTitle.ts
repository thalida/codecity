// hooks/useDocumentTitle.ts — The single owner of document.title. Reacts to the
// canonical signals: while a source is LOADING it shows "{pending} (pending) —
// codecity" (from PENDING_SOURCE_LABEL); otherwise "{label} — codecity" derived
// from MANIFEST, or plain "codecity" when nothing is loaded. Called once from
// <App />. (Replaces the old split where the fetch layer poked document.title
// directly via applyPendingTitle during streaming.)

import { useSignalEffect } from '@preact/signals';
import { MANIFEST } from '@/state/stores/manifest';
import { PENDING_SOURCE_LABEL } from '@/state/stores/source';
import { labelFromManifest } from '@/utils/sources';
import type { Manifest } from '@/types';

export function useDocumentTitle(): void {
  useSignalEffect(() => {
    const pending = PENDING_SOURCE_LABEL.value;
    if (pending !== null) {
      document.title = pending ? `${pending} (pending) — codecity` : 'codecity';
      return;
    }
    const m = MANIFEST.value;
    const label =
      labelFromManifest(m as Manifest | null) ??
      (m as { tree?: { name?: string } } | null)?.tree?.name ??
      '';
    document.title = label ? `${label} — codecity` : 'codecity';
  });
}

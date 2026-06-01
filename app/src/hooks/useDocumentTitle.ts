// src/hooks/useDocumentTitle.ts — Keeps document.title in sync with the
// canonical MANIFEST signal: "{label} — codecity" once a project is loaded,
// plain "codecity" otherwise. Called once from <App />.
//
// This replaces the imperative world.onChange → document.title assignment that
// lived in runtime/boot.ts. The "(pending) — codecity" title shown mid-load is
// still set by applyPendingTitle() during streaming; once a manifest lands,
// MANIFEST updates and this effect overwrites it with the final title.

import { useSignalEffect } from '@preact/signals';
import { MANIFEST } from '@/state/runtime/manifest';
import { labelFromManifest } from '@/utils/sources';
import type { Manifest } from '@/types';

export function useDocumentTitle(): void {
  useSignalEffect(() => {
    const m = MANIFEST.value;
    const label =
      labelFromManifest(m as Manifest | null) ??
      (m as { tree?: { name?: string } } | null)?.tree?.name ??
      '';
    document.title = label ? `${label} — codecity` : 'codecity';
  });
}

// utils/pendingTitle.ts — Sets document.title to "{label} (pending) — codecity"
// from a server-emitted `display_root`. Called from the manifest-stream consumer
// on the FIRST event that carries display_root so the tab title shows the
// project being loaded before any manifest exists.
//
// Exported here (rather than in boot.ts) so pendingTitle.test.ts can import
// it cleanly, and so boot.ts / appLogic.ts can re-export it for backward compat.

import { labelFromUrl } from './sources';

/**
 * Set document.title to "{label} (pending) — codecity" from a server-emitted
 * `display_root`. Once the final manifest lands, the caller replaces this with
 * the real title (the "(pending)" suffix disappears).
 *
 * Exported so the corresponding unit test can drive it without booting
 * the renderer.
 */
export function applyPendingTitle(displayRoot: string): void {
  const label = labelFromUrl(displayRoot);
  document.title = label ? `${label} (pending) — codecity` : 'codecity';
}

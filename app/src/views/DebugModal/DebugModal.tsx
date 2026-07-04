// views/DebugModal/DebugModal.tsx — Developer-only diagnostics, opened from
// the header's flag-gated bug icon (see utils/debugMode). Signal-driven like
// ShortcutsModal: App mounts one instance unconditionally, it reads
// DEBUG_OPEN directly and renders null when closed. Chrome
// (.modal-backdrop/.modal-card/.modal-header/.modal-body) reuses the global
// classes defined in styles/modal.css; this file only adds the action-button
// layout.

import './DebugModal.css';
import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { DEBUG_OPEN, closeDebug } from '@/state/stores/ui';

export interface DebugModalProps {
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export function DebugModal({ onRunCollisionCheck, onRunStemDiagnostic }: DebugModalProps) {
  const isOpen = DEBUG_OPEN.value;
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Registered only while open; the effect body itself is a no-op when closed
  // so there's nothing to tear down on the next mount. Also moves focus onto
  // the close button so keyboard focus doesn't stay stranded behind the
  // backdrop.
  useEffect(() => {
    if (!isOpen) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDebug();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDebug();
      }}
    >
      <div class="modal-card card-overlay" role="dialog" aria-modal="true" aria-label="Debug">
        <div class="modal-header surface-chrome">
          <span>Debug</span>
          <button
            ref={closeBtnRef}
            type="button"
            class="btn-icon btn-icon--lg"
            data-action="close"
            aria-label="Close"
            onClick={closeDebug}
          >
            <X class="lucide-icon" />
          </button>
        </div>
        <div class="modal-body">
          <p class="debug-hint">Developer-only diagnostics. Output goes to the browser console.</p>
          {onRunCollisionCheck && (
            <div class="theme-row">
              <button
                type="button"
                class="btn-secondary"
                title="Walks the current layout and logs any rect/rect overlaps."
                onClick={() => onRunCollisionCheck()}
              >
                Run collision check
              </button>
            </div>
          )}
          {onRunStemDiagnostic && (
            <div class="theme-row">
              <button
                type="button"
                class="btn-secondary"
                title="Re-runs layout under tracing and logs, per road, the chosen stem and binding obstacle for each child placement."
                onClick={() => onRunStemDiagnostic()}
              >
                Diagnose stem placement
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

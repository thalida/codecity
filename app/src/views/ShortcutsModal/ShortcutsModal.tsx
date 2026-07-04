// views/ShortcutsModal/ShortcutsModal.tsx — Reference-only modal for keyboard
// and mouse shortcuts, opened from the header's `?` icon. Signal-driven like
// LoadingOverlay: App mounts one instance unconditionally, it reads
// SHORTCUTS_OPEN directly and renders null when closed (no props). Chrome
// (.modal-backdrop/.modal-card/.modal-header/.modal-body) reuses the classes
// defined in views/SourcePicker/SourcePicker.css — that component is always
// mounted, so the rules are already global; this file only adds the
// shortcuts-list layout.

import './ShortcutsModal.css';
import { useEffect } from 'preact/hooks';
import { X } from 'lucide-preact';
import { SHORTCUTS_OPEN, closeShortcuts } from '@/state/stores/ui';
import { KEY_BINDINGS } from '@/constants/keyboard';

interface ShortcutItem {
  kbd?: string[];
  mouse?: string;
  action: string;
  or?: string;
}

const GENERAL_SHORTCUTS: Array<ShortcutItem | null> = [
  { kbd: [KEY_BINDINGS.RESET_VIEW.label], action: 'Reset the camera view' },
  { kbd: [KEY_BINDINGS.FOCUS_SELECTION.label], action: 'Focus camera on the current selection' },
  { kbd: [KEY_BINDINGS.CLEAR_SELECTION.label], action: 'Clear selection' },
  null,
  { mouse: 'Click', action: 'Select building / street / gem' },
  { mouse: 'Double-click', action: 'Focus camera on the target' },
  { mouse: 'Left drag', action: 'Orbit' },
  { mouse: 'Right drag', action: 'Pan' },
  { mouse: 'Middle drag', action: 'Dolly (zoom)' },
  { mouse: 'Scroll', action: 'Zoom toward cursor' },
];

function ShortcutsList({ items }: { items: Array<ShortcutItem | null> }) {
  return (
    <dl class="shortcuts-list">
      {items.map((item, idx) => {
        if (item == null) {
          return <div key={`div-${idx}`} class="shortcuts-divider" />;
        }
        const dt =
          item.kbd != null ? (
            <dt key={`dt-${idx}`}>
              {item.kbd.map((label, k) => (
                <>
                  {k > 0 && ' '}
                  <kbd key={`kbd-${idx}-${k}`}>{label}</kbd>
                </>
              ))}
              {item.or && <span class="shortcuts-or">{` ${item.or}`}</span>}
            </dt>
          ) : (
            <dt key={`dt-${idx}`}>
              <span class="shortcuts-mouse">{item.mouse}</span>
            </dt>
          );
        return (
          <>
            {dt}
            <dd key={`dd-${idx}`}>{item.action}</dd>
          </>
        );
      })}
    </dl>
  );
}

export function ShortcutsModal() {
  const isOpen = SHORTCUTS_OPEN.value;

  // Registered only while open; the effect body itself is a no-op when closed
  // so there's nothing to tear down on the next mount.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeShortcuts();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeShortcuts();
      }}
    >
      <div
        class="modal-card card-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div class="modal-header surface-chrome">
          <span>Keyboard & mouse</span>
          <button
            type="button"
            class="btn-icon btn-icon--lg"
            data-action="close"
            aria-label="Close"
            onClick={closeShortcuts}
          >
            <X class="lucide-icon" />
          </button>
        </div>
        <div class="modal-body">
          <h3 class="text-label">General</h3>
          <ShortcutsList items={GENERAL_SHORTCUTS} />
        </div>
      </div>
    </div>
  );
}

// views/ShortcutsModal/ShortcutsModal.tsx — Reference-only modal for keyboard
// and mouse shortcuts, opened from the header's `?` icon. Signal-driven like
// LoadingOverlay: App mounts one instance unconditionally, it reads
// SHORTCUTS_OPEN directly and renders null when closed (no props). Chrome
// (.modal-backdrop/.modal-card/.modal-header/.modal-body) reuses the global
// classes defined in styles/modal.css; this file only adds the
// shortcuts-list layout.

import './ShortcutsModal.css';
import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { SHORTCUTS_OPEN, closeShortcuts } from '@/state/stores/ui';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { useDialogFocus } from '@/hooks/useDialogFocus';

interface ShortcutItem {
  kbd?: string[];
  /** Modifier keys held while performing the mouse gesture (rendered as kbd chips). */
  mod?: string[];
  mouse?: string;
  action: string;
  or?: string;
}

const KEYBOARD_SHORTCUTS: ShortcutItem[] = [
  { kbd: [KEY_BINDINGS.RESET_VIEW.label], action: 'Reset the camera view' },
  { kbd: [KEY_BINDINGS.FOCUS_SELECTION.label], action: 'Focus camera on the current selection' },
  { kbd: [KEY_BINDINGS.CLEAR_SELECTION.label], action: 'Clear selection' },
];

const MOUSE_SHORTCUTS: ShortcutItem[] = [
  { mouse: 'Click', action: 'Select building / street / gem' },
  { mouse: 'Double-click', action: 'Focus camera on the target' },
  { mouse: 'Left drag', action: 'Orbit' },
  { mouse: 'Right drag', action: 'Pan' },
  {
    mod: ['⌘', 'Ctrl', 'Shift'],
    mouse: 'Left drag',
    action: 'Pan (for trackpads / one-button mice)',
  },
  { mouse: 'Middle drag', action: 'Dolly (zoom)' },
  { mouse: 'Scroll', action: 'Zoom toward cursor' },
];

function ShortcutsList({ items }: { items: ShortcutItem[] }) {
  return (
    <dl class="shortcuts-list">
      {items.map((item, idx) => {
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
              {item.mod?.map((m, k) => (
                <>
                  {k > 0 && ' / '}
                  <kbd key={`mod-${idx}-${k}`}>{m}</kbd>
                </>
              ))}
              {item.mod && ' + '}
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
  const rootRef = useRef<HTMLDivElement>(null);

  // Trap + restore focus and inert the background while open.
  useDialogFocus(isOpen, rootRef);

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
      ref={rootRef}
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeShortcuts();
      }}
    >
      <div
        class="modal-card card-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div class="modal-header surface-chrome">
          <span id="shortcuts-title">Keyboard & Mouse</span>
          <button
            type="button"
            class="btn-icon btn-icon--lg"
            data-action="close"
            aria-label="Close"
            onClick={closeShortcuts}
          >
            <X class="icon" />
          </button>
        </div>
        <div class="modal-body">
          <h3 class="text-label">Keyboard</h3>
          <ShortcutsList items={KEYBOARD_SHORTCUTS} />
          <h3 class="text-label">Mouse</h3>
          <ShortcutsList items={MOUSE_SHORTCUTS} />
        </div>
      </div>
    </div>
  );
}

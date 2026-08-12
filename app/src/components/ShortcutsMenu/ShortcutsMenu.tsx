// components/ShortcutsMenu/ShortcutsMenu.tsx — the keyboard and mouse
// reference, in the footer beside the other app-level controls.
//
// Open state lives in SHORTCUTS_OPEN rather than inside the popover: "?" opens
// this from anywhere (useShortcutsKey), and OVERLAY_OPEN reads it.

import './ShortcutsMenu.css';
import { Keyboard } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/Popover/Popover';
import { SHORTCUTS_OPEN } from '@/state/stores/ui';
import { KEY_BINDINGS } from '@/constants/keyboard';

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

export function ShortcutsMenu() {
  return (
    <Popover
      label="Keyboard and mouse"
      placement={PopoverPlacement.AboveStart}
      openSignal={SHORTCUTS_OPEN}
      triggerTitle="Keyboard shortcuts (?)"
      triggerLabel="Keyboard shortcuts"
      trigger={<Keyboard class="icon" aria-hidden="true" />}
    >
      {() => (
        <>
          <section class="popover-group">
            <div class="popover-group-head">
              <h3 class="popover-group-title">Keyboard</h3>
            </div>
            <ShortcutsList items={KEYBOARD_SHORTCUTS} />
          </section>
          <section class="popover-group">
            <div class="popover-group-head">
              <h3 class="popover-group-title">Mouse</h3>
            </div>
            <ShortcutsList items={MOUSE_SHORTCUTS} />
          </section>
        </>
      )}
    </Popover>
  );
}

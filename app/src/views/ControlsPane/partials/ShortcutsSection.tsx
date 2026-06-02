// views/ControlsPane/partials/ShortcutsSection.tsx — Static cheat-sheet for
// keyboard and mouse shortcuts. No draft binding — this is reference
// material rendered straight from KEY_BINDINGS plus hard-coded mouse
// affordances.

import { Section } from '@/components/Section';
import { Subgroup } from '@/components/Subgroup';
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

export function ShortcutsSection() {
  return (
    <Section
      name="Keyboard & mouse"
      hint="Quick reference for cursor actions and keyboard shortcuts."
    >
      <Subgroup name="General">
        <ShortcutsList items={GENERAL_SHORTCUTS} />
      </Subgroup>
    </Section>
  );
}

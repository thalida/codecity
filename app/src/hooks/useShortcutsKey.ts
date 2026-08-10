// hooks/useShortcutsKey.ts — "?" opens the keyboard-shortcuts panel.
//
// App-level rather than a scene shortcut: it has to work before any city is
// loaded. The footer's glyph is easy to miss, so this is how the panel is
// realistically reached.

import { useEffect } from 'preact/hooks';
import { openShortcuts, MODAL_OPEN } from '@/state/stores/ui';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { TEXT_INPUT_TAGS } from '@/constants/dom';

export function useShortcutsKey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!KEY_BINDINGS.SHOW_SHORTCUTS.keys.includes(e.key)) return;
      // "?" is a character someone types. A search field or a repo URL must
      // keep it rather than have a panel open over what they're writing.
      // The target is `document` for a keypress with nothing focused, which
      // has no tagName and no closest().
      const el = e.target instanceof Element ? e.target : null;
      if (TEXT_INPUT_TAGS.includes(el?.tagName ?? '')) return;
      // closest, not the element itself: typing in a rich-text area puts the
      // event on whichever child node holds the caret, not on the editable
      // root. (It also gives jsdom something to answer, which the
      // isContentEditable property is not.)
      if (el?.closest('[contenteditable="true"]')) return;
      // A modal already owns the keyboard, the shortcuts panel included.
      if (MODAL_OPEN.value) return;
      e.preventDefault();
      openShortcuts();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

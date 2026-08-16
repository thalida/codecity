// hooks/useShortcutsKey.ts — "?" opens the keyboard-shortcuts panel. Mounted by
// CityView, which is where the panel it opens renders: the footer's glyph is
// easy to miss, so this is how it is realistically reached.

import { useEffect } from 'preact/hooks';
import { openShortcuts, OVERLAY_OPEN } from '@/state/stores/modals';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { TEXT_INPUT_TAGS } from '@/constants/dom';

export function useShortcutsKey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!KEY_BINDINGS.SHOW_SHORTCUTS.keys.includes(e.key)) return;
      // "?" is a character someone types, so a field must keep it. With
      // nothing focused the target is `document`, which has no tagName.
      const el = e.target instanceof Element ? e.target : null;
      if (TEXT_INPUT_TAGS.includes(el?.tagName ?? '')) return;
      // closest, not the element: a rich-text caret puts the event on a child
      // node, not the editable root.
      if (el?.closest('[contenteditable="true"]')) return;
      // A modal already owns the keyboard, the shortcuts panel included.
      if (OVERLAY_OPEN.value) return;
      e.preventDefault();
      openShortcuts();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

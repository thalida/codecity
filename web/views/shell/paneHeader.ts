// views/shell/paneHeader.ts — Shared header bar used by every pane
// (Tree, Search, Info, Controls on the left sidebar; file-preview on
// the right). Single source of truth for the `.pane-header` row +
// `.text-pane-title` + `.pane-header-close` triplet, so the panes look
// identical and adding a new pane is a one-call affair.

import { makeLucideIcon } from './icon.js';

interface BuildPaneHeaderOpts {
  /** Initial title text. Update later via the returned api.setTitle. */
  title: string;
  /** Render the title in monospace — used by panes whose title is a
   *  filename / path identifier instead of a label. Defaults to false. */
  mono?: boolean;
  /** fn() when the user clicks the focus button. Omit to render no button.
   *  The button equivalent of pressing F on the canvas — used by the
   *  file-preview pane to frame the camera on the currently-shown file. */
  onFocus?: () => void;
  /** Tooltip text on the focus button. Defaults to "Focus camera". */
  focusTitle?: string;
  /** fn() when the user clicks the × close button. Omit to render no button. */
  onClose?: () => void;
  /** Tooltip text on the × button. Defaults to "Hide sidebar". */
  closeTitle?: string;
}

export function buildPaneHeader(opts: BuildPaneHeaderOpts) {
  const header = document.createElement('div');
  header.className = 'pane-header';

  // Slot for an optional leading element (e.g. an extension badge in the
  // file-preview pane). Inserted before the title; absent by default.
  let _prefixEl: HTMLElement | null = null;

  const title = document.createElement('h3');
  title.className = 'text-pane-title';
  if (opts.mono) title.classList.add('is-mono');
  title.textContent = opts.title;
  header.appendChild(title);

  // Focus button (optional) — sits at the FAR LEFT of the header, before
  // the prefix element (e.g. extension badge) and the title. Used by the
  // file-preview pane to mirror the F-key behaviour for the currently-shown
  // file.
  let _focusBtn: HTMLButtonElement | null = null;
  if (typeof opts.onFocus === 'function') {
    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'btn-icon btn-icon--text';
    const tooltip = opts.focusTitle ?? 'Focus camera';
    focusBtn.title = tooltip;
    focusBtn.setAttribute('aria-label', tooltip);
    focusBtn.appendChild(makeLucideIcon('focus'));
    focusBtn.addEventListener('click', () => {
      opts.onFocus!();
    });
    // Prepend so the button is the leftmost element. setPrefixEl (called
    // later by the file-preview pane) inserts BEFORE the title, which
    // keeps the badge between this button and the title.
    header.prepend(focusBtn);
    _focusBtn = focusBtn;
  }

  if (typeof opts.onClose === 'function') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-icon btn-icon--text';
    const tooltip = opts.closeTitle ?? 'Hide sidebar';
    closeBtn.title = tooltip;
    closeBtn.setAttribute('aria-label', tooltip);
    closeBtn.appendChild(makeLucideIcon('x'));
    closeBtn.addEventListener('click', () => {
      opts.onClose!();
    });
    header.appendChild(closeBtn);
  }

  return {
    el: header,
    api: {
      setTitle(text: string): void {
        title.replaceChildren(document.createTextNode(text));
      },
      /**
       * Replace the title element's children with arbitrary DOM nodes.
       * Pass an empty array to clear. Use `setTitle` for plain-text titles.
       */
      setTitleChildren(els: Node[]): void {
        title.replaceChildren(...els);
      },
      /** The raw title element — used by consumers that need to attach a
       *  ResizeObserver or read layout metrics from the title container. */
      get titleEl(): HTMLElement {
        return title;
      },
      /** Replace (or remove) the leading prefix element before the title. */
      setPrefixEl(el: HTMLElement | null): void {
        if (_prefixEl) {
          _prefixEl.remove();
          _prefixEl = null;
        }
        if (el) {
          _prefixEl = el;
          header.insertBefore(el, title);
        }
      },
      /** Enable / disable the focus button (no-op if no onFocus was passed). */
      setFocusEnabled(enabled: boolean): void {
        if (_focusBtn) _focusBtn.disabled = !enabled;
      },
    },
  };
}

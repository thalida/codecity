// views/shell/paneHeader.ts — Shared header bar used by every pane
// (Tree, Search, Info, Controls on the left sidebar; file-preview on
// the right). Single source of truth for the `.pane-header` row +
// `.pane-title` + `.pane-header-close` triplet, so the panes look
// identical and adding a new pane is a one-call affair.

import { makeLucideIcon } from './icon.js';

interface BuildPaneHeaderOpts {
  /** Initial title text. Update later via the returned api.setTitle. */
  title: string;
  /** Render the title in monospace — used by panes whose title is a
   *  filename / path identifier instead of a label. Defaults to false. */
  mono?: boolean;
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
  title.className = 'pane-title';
  if (opts.mono) title.classList.add('is-mono');
  title.textContent = opts.title;
  header.appendChild(title);

  if (typeof opts.onClose === 'function') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pane-header-close';
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
        title.textContent = text;
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
    },
  };
}

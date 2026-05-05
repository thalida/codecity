// views/panes/infoPane.js — "Info" tab in the left sidebar. Shows the
// rendered markdown of the project's root README (if any) — README.md,
// README.markdown, README, etc. Re-fetches and re-renders whenever the
// manifest is re-applied (which happens on live-update polling), so an
// edit to the README on disk shows up here without a page reload.

import { marked } from 'marked';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest } from '@/types';
import { makeLucideIcon } from '@/views/shell/icon.js';

// Match README, README.md, readme.markdown, README.txt — any file whose
// stem (case-insensitive) is "readme". GitHub/VSCode use the same rule.
const README_BASE_NAME = 'readme';

function _findRootReadme(manifest: Manifest | DirNode | null): FileNode | null {
  if (!manifest) return null;
  const tree =
    'tree' in manifest && (manifest as Manifest).tree
      ? (manifest as Manifest).tree
      : (manifest as DirNode);
  if (!tree || !('children' in tree) || !tree.children) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const c = tree.children[i];
    if (c.type !== NodeKind.File) continue;
    const name = (c.name || '').toLowerCase();
    if (name === README_BASE_NAME || name.indexOf(`${README_BASE_NAME}.`) === 0) return c;
  }
  return null;
}

// buildInfoPane(manifest, opts) -> { pane, api }
//
// opts.onClose      — fn() when the user clicks the × in the header.
//
// api.setManifest(manifest) — caller pushes the latest manifest in (e.g.
//   on cityScene.onChange after a live-update rebuild). The pane re-runs
//   the README lookup; if the root README's path or fullPath changes, it
//   re-fetches and re-renders. If only the contents changed (same path),
//   we still re-fetch — the manifest signature already proved something
//   on disk moved.
interface BuildInfoPaneOpts {
  onClose?: () => void;
}

export function buildInfoPane(
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null,
  opts: BuildInfoPaneOpts = {}
) {
  const pane = document.createElement('div');
  pane.className = 'left-pane info-pane';

  const header = document.createElement('div');
  header.className = 'info-header pane-header';
  const title = document.createElement('h3');
  title.className = 'info-title';
  title.textContent = 'Info';
  header.appendChild(title);
  if (typeof opts.onClose === 'function') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pane-header-close';
    closeBtn.title = 'Hide sidebar';
    closeBtn.setAttribute('aria-label', 'Hide sidebar');
    closeBtn.appendChild(makeLucideIcon('x'));
    closeBtn.addEventListener('click', () => {
      opts.onClose();
    });
    header.appendChild(closeBtn);
  }
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'info-body';
  pane.appendChild(body);

  // Track the current fetch so a stale response from a previous manifest
  // can't overwrite the latest render. Each render() bumps reqId; the
  // fetch handler only commits if its captured id still matches.
  let reqId = 0;

  function _renderEmptyState(): void {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'preview-state';
    box.appendChild(makeLucideIcon('book-open'));
    const h = document.createElement('p');
    h.className = 'preview-state-title';
    h.textContent = 'No README';
    box.appendChild(h);
    const sub = document.createElement('p');
    sub.className = 'preview-state-sub';
    sub.textContent = 'Add a README at the project root to fill this panel.';
    box.appendChild(sub);
    body.appendChild(box);
  }

  function _renderError(message: string): void {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'preview-state';
    box.appendChild(makeLucideIcon('file-warning'));
    const h = document.createElement('p');
    h.className = 'preview-state-title';
    h.textContent = 'Couldn’t load README';
    box.appendChild(h);
    if (message) {
      const sub = document.createElement('p');
      sub.className = 'preview-state-sub';
      sub.textContent = message;
      box.appendChild(sub);
    }
    body.appendChild(box);
  }

  function _renderMarkdown(text: string): void {
    const article = document.createElement('article');
    article.className = 'info-markdown';
    // marked.parse is synchronous when given a string and produces a
    // self-contained HTML fragment (no <html>/<head> wrapper). The
    // sandbox is the local file's own contents — nothing the renderer
    // injects that the user didn't already have on disk — so we render
    // as-is.
    // marked.parse returns string | Promise<string> in its types, but
    // the sync overload (no async option / no walkTokens) always returns
    // a string. Cast to keep the synchronous render flow.
    article.innerHTML = marked.parse(text) as string;
    body.replaceChildren(article);
  }

  function render(
    currentManifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
  ): void {
    const readme = _findRootReadme(currentManifest as Manifest | DirNode | null);
    if (!readme || !readme.fullPath) {
      _renderEmptyState();
      return;
    }
    const myReq = ++reqId;
    const url = `/api/file?path=${encodeURIComponent(readme.fullPath)}`;
    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then((text) => {
        if (myReq !== reqId) return; // stale — newer render in flight
        _renderMarkdown(text);
      })
      .catch((err) => {
        if (myReq !== reqId) return;
        _renderError((err && err.message) || 'Unknown error');
      });
  }

  render(manifest);

  return {
    pane,
    api: {
      setManifest(m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null) {
        render(m);
      },
    },
  };
}

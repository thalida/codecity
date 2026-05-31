// views/panes/infoPane.tsx — "Info" tab in the left sidebar. Shows the
// rendered markdown of the project's root README (if any) — README.md,
// README.markdown, README, etc. Re-fetches and re-renders whenever the
// manifest is re-applied (which happens on live-update polling), so an
// edit to the README on disk shows up here without a page reload.

import { useState, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { fetchFileText } from '@/api/file';
import { marked } from 'marked';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest } from '@/types';
import { makeLucideIcon } from '@/views/components/LucideIcon';
import { buildPaneHeader } from '@/views/components/PaneHeader';
import { isEmptyManifest } from '@/utils/manifest';

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

// ── State shape for Preact component ─────────────────────────────────────────

type InfoBodyState =
  | { kind: 'no-project' }
  | { kind: 'no-readme' }
  | { kind: 'loading' }
  | { kind: 'markdown'; html: string }
  | { kind: 'error'; message: string };

export interface InfoPaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
  onClose?: () => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function InfoPane({ manifest, onClose }: InfoPaneProps) {
  const [body, setBody] = useState<InfoBodyState>({ kind: 'no-project' });

  useEffect(() => {
    let cancelled = false;

    const doFetch = (
      m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
    ) => {
      if (isEmptyManifest(m)) {
        setBody({ kind: 'no-project' });
        return;
      }
      const readme = _findRootReadme(m as Manifest | DirNode | null);
      if (!readme || !readme.fullPath) {
        setBody({ kind: 'no-readme' });
        return;
      }
      setBody({ kind: 'loading' });
      fetchFileText(readme.fullPath)
        .then((text) => {
          if (!cancelled) setBody({ kind: 'markdown', html: marked.parse(text) as string });
        })
        .catch((err) => {
          if (!cancelled) setBody({ kind: 'error', message: (err && err.message) || 'Unknown error' });
        });
    };

    // effect() fires once immediately + on every manifest change.
    const unsub = effect(() => {
      doFetch(manifest.value);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [manifest]);

  return (
    <div class="pane info-pane">
      <div class="pane-header">
        <h3 class="text-pane-title">Info</h3>
        {typeof onClose === 'function' && (
          <button
            type="button"
            class="btn-icon btn-icon--text"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={() => onClose()}
          >
          </button>
        )}
      </div>
      <div class="pane-body info-body">
        {body.kind === 'no-project' && (
          <div class="empty-state empty-state--lg">
            <p class="text-card-title">No project loaded</p>
            <p class="text-card-sub">Open one to read its README.</p>
          </div>
        )}
        {body.kind === 'no-readme' && (
          <div class="empty-state empty-state--lg">
            <p class="text-card-title">No README</p>
            <p class="text-card-sub">Add a README at the project root to fill this panel.</p>
          </div>
        )}
        {body.kind === 'error' && (
          <div class="empty-state empty-state--lg">
            <p class="text-card-title">{"Couldn't load README"}</p>
            <p class="text-card-sub">{body.message}</p>
          </div>
        )}
        {body.kind === 'markdown' && (
          <article
            class="info-markdown"
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        )}
      </div>
    </div>
  );
}

// ── Backward-compat factory ───────────────────────────────────────────────────
// buildInfoPane(manifest, opts) -> { pane, api }
//
// opts.onClose      — fn() when the user clicks the x in the header.
//
// api.setManifest(manifest) — caller pushes the latest manifest in (e.g.
//   on world.onChange after a live-update rebuild). The pane re-runs
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
  pane.className = 'pane info-pane';

  const { el: header } = buildPaneHeader({ title: 'Info', onClose: opts.onClose });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane-body info-body';
  pane.appendChild(body);

  // Track the current fetch so a stale response from a previous manifest
  // can't overwrite the latest render. Each render() bumps reqId; the
  // fetch handler only commits if its captured id still matches.
  let reqId = 0;

  function _renderEmptyState(): void {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'empty-state empty-state--lg';
    box.appendChild(makeLucideIcon('book-open'));
    const h = document.createElement('p');
    h.className = 'text-card-title';
    h.textContent = 'No README';
    box.appendChild(h);
    const sub = document.createElement('p');
    sub.className = 'text-card-sub';
    sub.textContent = 'Add a README at the project root to fill this panel.';
    box.appendChild(sub);
    body.appendChild(box);
  }

  function _renderNoProjectState(): void {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'empty-state empty-state--lg';
    box.appendChild(makeLucideIcon('folder-open'));
    const h = document.createElement('p');
    h.className = 'text-card-title';
    h.textContent = 'No project loaded';
    box.appendChild(h);
    const sub = document.createElement('p');
    sub.className = 'text-card-sub';
    sub.textContent = 'Open one to read its README.';
    box.appendChild(sub);
    body.appendChild(box);
  }

  function _renderError(message: string): void {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'empty-state empty-state--lg';
    box.appendChild(makeLucideIcon('file-warning'));
    const h = document.createElement('p');
    h.className = 'text-card-title';
    h.textContent = "Couldn't load README";
    box.appendChild(h);
    if (message) {
      const sub = document.createElement('p');
      sub.className = 'text-card-sub';
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

  function renderBody(
    currentManifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
  ): void {
    if (isEmptyManifest(currentManifest)) {
      _renderNoProjectState();
      return;
    }
    const readme = _findRootReadme(currentManifest as Manifest | DirNode | null);
    if (!readme || !readme.fullPath) {
      _renderEmptyState();
      return;
    }
    const myReq = ++reqId;
    fetchFileText(readme.fullPath)
      .then((text) => {
        if (myReq !== reqId) return; // stale — newer render in flight
        _renderMarkdown(text);
      })
      .catch((err) => {
        if (myReq !== reqId) return;
        _renderError((err && err.message) || 'Unknown error');
      });
  }

  renderBody(manifest);

  return {
    pane,
    api: {
      setManifest(m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null) {
        renderBody(m);
      },
    },
  };
}

// views/panes/searchPane.tsx — "Search" tab in the left sidebar. A
// path-search over the project's files. Indexes the flat list of files
// from the manifest tree; each keystroke runs the matcher across the
// index and renders the top-N results. Clicking a result fires
// onSelect(path) so the host can route it through the picker (same
// pathway as a tree click / breadcrumb click).
//
// Matching: whitespace-separated tokens. Each token must appear as a
// contiguous case-insensitive substring of the target path; missing any
// token fails the match. Searching ".png" therefore looks for the literal
// ".png" string, not for `.`, `p`, `n`, `g` scattered across the path.
// Score rewards (a) earlier matches (smaller idx penalty), (b) prefix
// matches, and (c) matches that begin at word boundaries (after `/`,
// `_`, `-`, `.`). Shorter targets win ties. No external dep; O(target
// length x tokens) per file, fine for tens of thousands of paths on
// every keystroke.

import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest, TreeNode } from '@/types';
import { makeLucideIcon, LucideIcon } from '@/views/components/LucideIcon';
import { buildPaneHeader } from '@/views/components/PaneHeader';

const MAX_RESULTS = 50;
const WORD_BOUNDARY_RE = /[/_\-.]/;

interface PathMatch {
  /** Indices in the target covered by token matches (may be unsorted; deduped via Set in highlight). */
  positions: number[];
  /** Higher is better. */
  score: number;
}

interface BuildSearchPaneOpts {
  /** fn() when the user clicks the x in the header. */
  onClose?: () => void;
  /** fn(path) when a result row is single-clicked. Caller routes to picker.selectByPath. */
  onSelect?: (path: string) => void;
  /** fn(path) when a result row is double-clicked. Caller routes to rig.focusBuilding. */
  onFocus?: (path: string) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export interface SearchPaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
  onClose?: () => void;
  onSelect?: (path: string) => void;
  onFocus?: (path: string) => void;
}

export function SearchPane({ manifest, onClose, onSelect, onFocus }: SearchPaneProps) {
  const [query, setQuery] = useState('');
  const files = _flattenFiles(manifest.value);
  const trimmed = query.trim();
  const results = trimmed ? _searchFiles(trimmed, files) : null;

  return (
    <div class="pane search-pane">
      <div class="pane-header">
        <h3 class="text-pane-title">Search</h3>
        {typeof onClose === 'function' && (
          <button
            type="button"
            class="btn-icon btn-icon--text"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={() => onClose()}
          />
        )}
      </div>
      <div class="search-input-wrap">
        <LucideIcon name="search" class="search-input-icon" />
        <input
          type="search"
          class="form-input search-input"
          placeholder="Search files by path"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="pane-body">
        {!trimmed && (
          <div class="empty-state">
            <p class="text-card-title">Start typing to search files</p>
            <p class="text-card-sub">
              Matches the full project-relative path, including the file extension.
            </p>
          </div>
        )}
        {trimmed && results && results.length === 0 && (
          <div class="empty-state">
            <p class="text-card-title">No files match</p>
            <p class="text-card-sub">No path matches &quot;{trimmed}&quot;.</p>
          </div>
        )}
        {results && results.length > 0 && (
          <ul class="search-results">
            {results.map(({ file, match }) => (
              <li
                key={file.path}
                class="search-result"
                tabIndex={0}
                onClick={() => { if (onSelect && file.path) onSelect(file.path); }}
                onDblClick={() => { if (onFocus && file.path) onFocus(file.path); }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' && onSelect && file.path) onSelect(file.path);
                }}
              >
                <span class="search-result-path">
                  {_highlightJsx(file.path, match.positions)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Render highlighted path as JSX with <mark> for matched positions. */
function _highlightJsx(path: string, positions: number[]): h.JSX.Element[] {
  const set = new Set(positions);
  const parts: h.JSX.Element[] = [];
  let i = 0;
  let key = 0;
  while (i < path.length) {
    if (set.has(i)) {
      let end = i;
      while (end < path.length && set.has(end)) end++;
      parts.push(<mark key={key++}>{path.slice(i, end)}</mark>);
      i = end;
    } else {
      let end = i;
      while (end < path.length && !set.has(end)) end++;
      parts.push(<span key={key++}>{path.slice(i, end)}</span>);
      i = end;
    }
  }
  return parts;
}

// ── Backward-compat factory ───────────────────────────────────────────────────
/**
 * Build the search pane. Returns:
 *   pane — `<div class="left-pane search-pane">` to mount into the left panel.
 *   api.setManifest(manifest) — re-index when the manifest changes.
 *   api.focus() — focus the search input (called when the tab is activated).
 */
export function buildSearchPane(
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null,
  opts: BuildSearchPaneOpts = {}
) {
  const pane = document.createElement('div');
  pane.className = 'pane search-pane';

  const { el: header } = buildPaneHeader({ title: 'Search', onClose: opts.onClose });
  pane.appendChild(header);

  const inputWrap = document.createElement('div');
  inputWrap.className = 'search-input-wrap';
  inputWrap.appendChild(makeLucideIcon('search', { class: 'search-input-icon' }));
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'form-input search-input';
  input.placeholder = 'Search files by path';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  inputWrap.appendChild(input);
  pane.appendChild(inputWrap);

  const body = document.createElement('div');
  body.className = 'pane-body';
  pane.appendChild(body);

  let files: FileNode[] = _flattenFiles(manifest);
  _renderEmptyHint();

  input.addEventListener('input', () => {
    _render(input.value);
  });

  function setManifest(
    m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
  ): void {
    files = _flattenFiles(m);
    _render(input.value);
  }

  function focus(): void {
    input.focus();
    // Select existing content so the user can either type to replace or
    // pick up where they left off.
    input.select();
  }

  function _render(query: string): void {
    body.replaceChildren();
    const trimmed = query.trim();
    if (!trimmed) {
      _renderEmptyHint();
      return;
    }
    const results = _searchFiles(trimmed, files);
    if (results.length === 0) {
      body.appendChild(
        _makeStateMessage('search-x', 'No files match', `No path matches "${trimmed}".`)
      );
      return;
    }
    const list = document.createElement('ul');
    list.className = 'search-results';
    for (const { file, match } of results) {
      list.appendChild(_buildResultRow(file, match));
    }
    body.appendChild(list);
  }

  function _renderEmptyHint(): void {
    body.appendChild(
      _makeStateMessage(
        'search',
        'Start typing to search files',
        'Matches the full project-relative path, including the file extension.'
      )
    );
  }

  function _buildResultRow(file: FileNode, match: PathMatch): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'search-result';
    li.tabIndex = 0;

    const path = document.createElement('span');
    path.className = 'search-result-path';
    path.appendChild(_highlight(file.path, match.positions));
    li.appendChild(path);

    li.addEventListener('click', () => {
      if (opts.onSelect && file.path) opts.onSelect(file.path);
    });
    // Double-click focuses the building in the city — mirrors the tree
    // pane's click/dblclick contract. The browser fires the single-
    // click for the first half of a dblclick anyway, so the selection
    // happens before the focus, which is the order we want.
    li.addEventListener('dblclick', () => {
      if (opts.onFocus && file.path) opts.onFocus(file.path);
    });
    // Enter on a focused row triggers selection — gives keyboarders a
    // working flow even without up/down navigation in v1.
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && opts.onSelect && file.path) opts.onSelect(file.path);
    });
    return li;
  }

  return {
    pane,
    api: {
      setManifest,
      focus,
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────

function _flattenFiles(
  manifest: Manifest | DirNode | TreeNode | { tree?: unknown; [k: string]: unknown } | null
): FileNode[] {
  const out: FileNode[] = [];
  if (!manifest) return out;
  const root =
    'tree' in (manifest as { tree?: unknown }) && (manifest as Manifest).tree
      ? (manifest as Manifest).tree
      : (manifest as TreeNode);
  _walk(root, out);
  return out;
}

function _walk(node: TreeNode | DirNode, out: FileNode[]): void {
  if (!node) return;
  if (node.type === NodeKind.File) {
    out.push(node);
    return;
  }
  const dir = node as DirNode;
  if (Array.isArray(dir.children)) {
    for (let i = 0; i < dir.children.length; i++) _walk(dir.children[i], out);
  }
}

function _searchFiles(
  query: string,
  files: FileNode[]
): Array<{ file: FileNode; match: PathMatch }> {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const results: Array<{ file: FileNode; match: PathMatch }> = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const target = file.path || '';
    if (!target) continue;
    const match = _matchTokens(tokens, target.toLowerCase());
    if (match) results.push({ file, match });
  }
  results.sort((a, b) => b.match.score - a.match.score);
  return results.slice(0, MAX_RESULTS);
}

/**
 * Token-based substring matcher. Every token (already lowercased) must
 * appear as a contiguous substring of the lowercased target — if any
 * token is absent, the match fails. Returns the union of matched
 * character positions and a heuristic score. Token order in the query
 * does not have to mirror the target.
 */
function _matchTokens(tokens: string[], t: string): PathMatch | null {
  const positions: number[] = [];
  let score = 0;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    const idx = t.indexOf(token);
    if (idx < 0) return null;
    for (let i = idx; i < idx + token.length; i++) positions.push(i);
    if (idx === 0) score += 100;
    if (idx > 0 && WORD_BOUNDARY_RE.test(t[idx - 1])) score += 25;
    score -= idx;
  }
  // Shorter targets win when scores are otherwise equal.
  score -= t.length / 1000;
  return { positions, score };
}

/**
 * Build a fragment with the matched positions wrapped in <mark>.
 * Adjacent matches collapse into a single <mark> to minimize node count.
 */
function _highlight(path: string, positions: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set = new Set(positions);
  let i = 0;
  while (i < path.length) {
    if (set.has(i)) {
      let end = i;
      while (end < path.length && set.has(end)) end++;
      const m = document.createElement('mark');
      m.textContent = path.slice(i, end);
      frag.appendChild(m);
      i = end;
    } else {
      let end = i;
      while (end < path.length && !set.has(end)) end++;
      frag.appendChild(document.createTextNode(path.slice(i, end)));
      i = end;
    }
  }
  return frag;
}

function _makeStateMessage(iconName: string, title: string, subtitle?: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'empty-state';
  box.appendChild(makeLucideIcon(iconName));
  const h = document.createElement('p');
  h.className = 'text-card-title';
  h.textContent = title;
  box.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'text-card-sub';
    sub.textContent = subtitle;
    box.appendChild(sub);
  }
  return box;
}

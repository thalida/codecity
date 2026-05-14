// views/panes/searchPane.ts — "Search" tab in the left sidebar. A fuzzy
// path-search over the project's files. Indexes the flat list of files
// from the manifest tree; each keystroke runs the fuzzy matcher across
// the index and renders the top-N results. Clicking a result fires
// onSelect(path) so the host can route it through the picker (same
// pathway as a tree click / breadcrumb click).
//
// Matching: per query char, the matcher scans forward in the target for
// the next case-insensitive occurrence. A missing char fails the match.
// Score rewards (a) compact spans, (b) matches that begin at word
// boundaries (after `/`, `_`, `-`, `.`), (c) prefix matches, and
// (d) adjacent-character runs — fzy/fzf-style heuristics. No external
// dep; the algorithm is O(target.length) per file, fine for tens of
// thousands of paths on every keystroke.

import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest, TreeNode } from '@/types';
import { makeLucideIcon } from '@/views/shell/icon.js';

const MAX_RESULTS = 50;
const WORD_BOUNDARY_RE = /[/_\-.]/;

interface FuzzyMatch {
  /** Indices in the target where each query char landed (in order). */
  positions: number[];
  /** Higher is better. */
  score: number;
}

interface BuildSearchPaneOpts {
  /** fn() when the user clicks the × in the header. */
  onClose?: () => void;
  /** fn(path) when a result row is clicked. Caller routes to picker.selectByPath. */
  onSelect?: (path: string) => void;
}

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
  pane.className = 'left-pane search-pane';

  const header = document.createElement('div');
  header.className = 'search-header pane-header';
  const title = document.createElement('h3');
  title.className = 'search-title';
  title.textContent = 'Search';
  header.appendChild(title);
  if (typeof opts.onClose === 'function') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pane-header-close';
    closeBtn.title = 'Hide sidebar';
    closeBtn.setAttribute('aria-label', 'Hide sidebar');
    closeBtn.appendChild(makeLucideIcon('x'));
    closeBtn.addEventListener('click', () => {
      opts.onClose!();
    });
    header.appendChild(closeBtn);
  }
  pane.appendChild(header);

  const inputWrap = document.createElement('div');
  inputWrap.className = 'search-input-wrap';
  inputWrap.appendChild(makeLucideIcon('search', { class: 'search-input-icon' }));
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'search-input';
  input.placeholder = 'Fuzzy search files by path';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  inputWrap.appendChild(input);
  pane.appendChild(inputWrap);

  const body = document.createElement('div');
  body.className = 'search-body';
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
        _makeStateMessage('search-x', 'No files match', `No path matches “${trimmed}”.`)
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

  function _buildResultRow(file: FileNode, match: FuzzyMatch): HTMLLIElement {
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
    // Enter on a focused row triggers selection — gives keyboarders a
    // working flow even without ↑↓ navigation in v1.
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
  manifest:
    | Manifest
    | DirNode
    | TreeNode
    | { tree?: unknown; [k: string]: unknown }
    | null
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
): Array<{ file: FileNode; match: FuzzyMatch }> {
  const q = query.toLowerCase();
  const results: Array<{ file: FileNode; match: FuzzyMatch }> = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const target = file.path || '';
    if (!target) continue;
    const match = _fuzzyMatch(q, target.toLowerCase());
    if (match) results.push({ file, match });
  }
  results.sort((a, b) => b.match.score - a.match.score);
  return results.slice(0, MAX_RESULTS);
}

/**
 * Greedy left-to-right fuzzy match. Returns the matched positions and a
 * heuristic score, or null if any query character is absent. Both
 * inputs MUST already be lowercased — callers pre-lowercase once.
 */
function _fuzzyMatch(q: string, t: string): FuzzyMatch | null {
  if (!q) return null;
  const positions: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    while (ti < t.length) {
      if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found < 0) return null;
    positions.push(found);
  }

  // Score: penalize span; bonus prefix, word-boundary starts, adjacent
  // runs. Tuned so a short query lands its closest cluster on top.
  const span = positions[positions.length - 1] - positions[0];
  let score = -span;
  if (positions[0] === 0) score += 100;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (p > 0 && WORD_BOUNDARY_RE.test(t[p - 1])) score += 25;
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] === positions[i - 1] + 1) score += 5;
  }
  // Shorter targets win when scores are otherwise equal — implemented
  // as a tiny tiebreaker by subtracting the target length / 1000.
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
  box.className = 'search-state';
  box.appendChild(makeLucideIcon(iconName));
  const h = document.createElement('p');
  h.className = 'search-state-title';
  h.textContent = title;
  box.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'search-state-sub';
    sub.textContent = subtitle;
    box.appendChild(sub);
  }
  return box;
}

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

import type { VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest, TreeNode } from '@/types';
import { Search, SearchX } from 'lucide-preact';
import { Pane, PaneEmpty } from '@/components/Pane';

const MAX_RESULTS = 50;
const WORD_BOUNDARY_RE = /[/_\-.]/;

interface PathMatch {
  /** Indices in the target covered by token matches (may be unsorted; deduped via Set in highlight). */
  positions: number[];
  /** Higher is better. */
  score: number;
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
  // Flatten once per manifest, not per keystroke — _flattenFiles is an O(N)
  // tree walk and setQuery re-renders on every character typed.
  const files = useMemo(() => _flattenFiles(manifest.value), [manifest.value]);
  const trimmed = query.trim();
  const results = trimmed ? _searchFiles(trimmed, files) : null;

  return (
    <Pane paneClass="search-pane" title="Search" onClose={onClose}>
      <div class="search-input-wrap">
        <Search class="lucide-icon search-input-icon" />
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
          <PaneEmpty
            large={false}
            icon={Search}
            title="Start typing to search files"
            sub="Matches the full project-relative path, including the file extension."
          />
        )}
        {trimmed && results && results.length === 0 && (
          <PaneEmpty large={false} icon={SearchX} title="No files match" sub={`No path matches "${trimmed}".`} />
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
    </Pane>
  );
}

/** Render highlighted path as JSX with <mark> for matched positions. */
function _highlightJsx(path: string, positions: number[]): VNode[] {
  const set = new Set(positions);
  const parts: VNode[] = [];
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

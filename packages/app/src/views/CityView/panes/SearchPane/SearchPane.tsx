// views/SearchPane.tsx — path search over the project's files. Tokens are
// contiguous substrings, not scattered characters, so ".png" finds the literal
// string; scoring favours earlier matches, prefixes and word boundaries. Cheap
// enough to re-run over tens of thousands of paths on every keystroke.

import { DirNode, FileNode, Manifest, NodeKind, TreeNode } from '@codecity/city';
import './SearchPane.css';
import type { VNode } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Search, SearchX } from 'lucide-preact';
import { Pane } from '@/components/panes/Pane/Pane';
import { PaneEmpty } from '@/components/panes/PaneEmpty/PaneEmpty';
import { PaneCloseButton } from '@/components/panes/PaneCloseButton/PaneCloseButton';
import { NodeIcon } from '@/components/nodes/NodeIcon/NodeIcon';

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
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;
  onClose?: () => void;
  onSelect?: (path: string) => void;
}

export function SearchPane({ manifest, onClose, onSelect }: SearchPaneProps) {
  const [query, setQuery] = useState('');
  // Flatten once per manifest, not per keystroke — _flattenFiles is an O(N)
  // tree walk and setQuery re-renders on every character typed.
  const files = useMemo(() => _flattenFiles(manifest), [manifest]);
  const trimmed = query.trim();
  const results = trimmed ? _searchFiles(trimmed, files) : null;

  // Focus-based, not aria-activedescendant, so the buttons keep native Enter
  // and a screen reader announces the result you're on.
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);

  const resultButtons = () =>
    Array.from(resultsRef.current?.querySelectorAll<HTMLButtonElement>('.search-result') ?? []);

  const focusResultAt = (index: number) => {
    const btns = resultButtons();
    if (btns.length === 0) return;
    btns[Math.max(0, Math.min(index, btns.length - 1))].focus();
  };

  const onInputKeyDown = (e: KeyboardEvent) => {
    const btns = resultButtons();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusResultAt(0);
    } else if (e.key === 'ArrowUp' && btns.length > 0) {
      e.preventDefault();
      focusResultAt(btns.length - 1);
    }
  };

  const onResultsKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = resultButtons();
    if (btns.length === 0) return;
    e.preventDefault();
    const current = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      focusResultAt(current < 0 ? 0 : current + 1);
    } else if (current <= 0) {
      inputRef.current?.focus(); // ArrowUp off the top returns to the query field
    } else {
      focusResultAt(current - 1);
    }
  };

  return (
    <Pane
      paneClass="search-pane"
      headerSlot={
        <div class="pane-header pane-header--search">
          <div class="search-input-wrap">
            <Search class="icon search-input-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              class="form-input search-input"
              placeholder="Search files by path"
              aria-label="Search files by path"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={onInputKeyDown}
            />
          </div>
          {onClose && <PaneCloseButton onClose={onClose} />}
        </div>
      }
    >
      <div class="pane-body">
        {/* Announce the result count as the query changes (screen-reader users
            get no visual cue of how many matches appeared). */}
        <div class="sr-only" role="status" aria-live="polite">
          {trimmed && results
            ? results.length === 0
              ? 'No files match'
              : `${results.length} result${results.length === 1 ? '' : 's'}`
            : ''}
        </div>
        {!trimmed && (
          <PaneEmpty
            large={false}
            icon={Search}
            title="Start typing to search files"
            sub="Matches the full project-relative path, including the file extension."
          />
        )}
        {trimmed && results && results.length === 0 && (
          <PaneEmpty
            large={false}
            icon={SearchX}
            title="No files match"
            sub={`No path matches "${trimmed}".`}
          />
        )}
        {results && results.length > 0 && (
          <ul class="search-results" ref={resultsRef} onKeyDown={onResultsKeyDown}>
            {results.map(({ file, match }) => (
              <li key={file.path}>
                <button
                  type="button"
                  class="row search-result focus-inset"
                  onClick={() => {
                    if (onSelect && file.path) onSelect(file.path);
                  }}
                >
                  <NodeIcon node={file} />
                  <span class="search-result-path">
                    {_highlightJsx(file.path, match.positions)}
                  </span>
                </button>
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

/** Every token must appear as a contiguous substring, in any order. Returns the
 *  matched positions and a score. */
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

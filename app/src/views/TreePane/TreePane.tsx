// views/TreePane.tsx — Left sidebar tree view. Renders a
// collapsible folder/file tree that mirrors the city's layout
// (alphabetical, files+dirs intermingled — see layout.js _layoutDir)
// and stays bidirectionally synced with the scene's current selection.
//
// Single-branch invariant: only one chain from the root is ever
// exposed at a time. Expanding a dir closes every other branch;
// selection-driven highlight (from the city) expands the ancestor
// chain of the selected node.

import './TreePane.css';
import { effect, useComputed } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { NodeKind } from '@/types';
import type { DirNode, Manifest, TreeNode } from '@/types';
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-preact';
import { GemIcon } from '@/components/GemIcon/GemIcon';
import { NodeIcon } from '@/components/NodeIcon/NodeIcon';
import { Pane, PaneEmpty } from '@/components/Pane';

// ── Helpers ──────────────────────────────────────────────────────────

function _treeRoot(
  m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
): TreeNode | null {
  if (!m) return null;
  return ('tree' in m && (m as Manifest).tree) || (m as TreeNode);
}

/** Set of paths to expand so `targetPath` is visible (target + ancestors). */
function _ancestorChain(targetPath: string, rootPath: string): Set<string> {
  const chain = new Set<string>();
  if (rootPath) chain.add(rootPath);
  if (!targetPath) return chain;
  const segs = targetPath.split('/').filter(Boolean);
  let acc = '';
  for (const seg of segs) {
    acc = acc ? `${acc}/${seg}` : seg;
    chain.add(acc);
  }
  return chain;
}

function _sortChildren(children: readonly TreeNode[] | undefined): TreeNode[] {
  if (!children || children.length === 0) return [];
  return children.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// ── Item component ──────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  isRoot?: boolean;
  rootPath: string;
  expanded: Signal<Set<string>>;
  selectedPath: ReadonlySignal<string | null>;
  hoveredPath: ReadonlySignal<string | null>;
  onSelect?: (node: TreeNode) => void;
  onFocus?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

function TreeItem({
  node,
  isRoot = false,
  rootPath,
  expanded,
  selectedPath,
  hoveredPath,
  onSelect,
  onFocus,
  onHover,
  onHoverEnd,
}: TreeItemProps) {
  const isDir = node.type === NodeKind.Directory;
  const path = node.path ?? '';
  // .value reads track the signal so the row re-renders on each change.
  const isExpanded = isDir && expanded.value.has(path);
  const isSelected = path !== '' && selectedPath.value === path;
  const isHovered = path !== '' && hoveredPath.value === path;
  const ref = useRef<HTMLLIElement>(null);

  // Selected → scroll into view (matches the imperative version). Only
  // scrolls when newly selected; idempotent re-renders of the same
  // selected row are silent because scrollIntoView is a no-op when the
  // element is already in the viewport.
  useEffect(() => {
    if (isSelected && ref.current?.scrollIntoView) {
      ref.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [isSelected]);

  function toggleExpanded() {
    const cur = expanded.value;
    if (cur.has(path)) {
      // Collapsing only collapses this dir — invariant trivially holds.
      const next = new Set(cur);
      next.delete(path);
      expanded.value = next;
    } else {
      // Expanding enforces the single-branch invariant: only ancestor
      // chain (plus this) stays open; every other branch collapses.
      expanded.value = new Set([..._ancestorChain(path, rootPath), path]);
    }
  }

  const classes: string[] = ['tree-item'];
  if (isRoot) classes.push('tree-root-item');
  if (isDir) classes.push('tree-dir', isExpanded ? 'tree-expanded' : 'tree-collapsed');
  else classes.push('tree-file');
  if (isSelected) classes.push('tree-selected');
  if (isHovered) classes.push('tree-hovered');

  const children = isDir ? _sortChildren((node as DirNode).children) : [];

  return (
    <li ref={ref} class={classes.join(' ')} data-path={path}>
      <div
        class="row row--tight"
        onClick={(e) => {
          e.stopPropagation();
          if (onSelect) onSelect(node);
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          if (onFocus) onFocus(node);
        }}
        onMouseEnter={() => onHover?.(node)}
        onMouseLeave={() => onHoverEnd?.(node)}
      >
        {/* Chevron column — for directories, clickable toggle; for
            files (and the root, where collapse is a dead-end), a
            placeholder so labels line up across siblings. */}
        {isDir && !isRoot ? (
          <span
            class="tree-chevron"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded();
            }}
          >
            {isExpanded ? (
              <ChevronDown class="lucide-icon tree-icon tree-icon-dir" />
            ) : (
              <ChevronRight class="lucide-icon tree-icon tree-icon-dir" />
            )}
          </span>
        ) : (
          <span class="tree-chevron">
            {isDir && isRoot && <ChevronDown class="lucide-icon tree-icon tree-icon-dir" />}
          </span>
        )}
        {/* Glyph: root uses the brand gem (monochrome); every other node
            gets its Material file/folder icon (NodeIcon dispatches on type). */}
        {isDir && isRoot ? <GemIcon simple class="tree-root-glyph" /> : <NodeIcon node={node} />}
        <span class="tree-label">{node.name || ''}</span>
      </div>
      {isDir && isExpanded && children.length > 0 && (
        <ul class="tree-list">
          {children.map((child) => (
            <TreeItem
              key={child.path ?? child.name}
              node={child}
              rootPath={rootPath}
              expanded={expanded}
              selectedPath={selectedPath}
              hoveredPath={hoveredPath}
              onSelect={onSelect}
              onFocus={onFocus}
              onHover={onHover}
              onHoverEnd={onHoverEnd}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Pane component ──────────────────────────────────────────────────

export interface TreePaneProps {
  manifest: ReadonlySignal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
  selectedPath: ReadonlySignal<string | null>;
  hoveredPath: ReadonlySignal<string | null>;
  /** Set of expanded directory paths. The pane reads (for which subtrees
   *  to render) and writes (when the user clicks a chevron) this signal.
   *  The selection→expansion bridge lives outside the component so it's
   *  wired up synchronously; the component itself is reactive on the
   *  signal's current value. */
  expanded: Signal<Set<string>>;
  rootPath: string;
  onClose?: () => void;
  onSelect?: (node: TreeNode) => void;
  onFocus?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

export function TreePane({
  manifest,
  selectedPath,
  hoveredPath,
  expanded,
  rootPath,
  onClose,
  onSelect,
  onFocus,
  onHover,
  onHoverEnd,
}: TreePaneProps) {
  const treeSig = useComputed(() => _treeRoot(manifest.value));
  const tree = treeSig.value;

  // Selection → expansion bridge. Subscribes via useEffect so the
  // production JSX usage (LeftSidebar mounts <TreePane /> directly) gets
  // automatic ancestor-chain expansion when picker selection moves.
  useEffect(() => {
    // effect() fires immediately + on every selectedPath change, and returns
    // its own disposer — so the bridge is set up and torn down with the mount.
    return effect(() => {
      const p = selectedPath.value;
      expanded.value = p == null ? new Set([rootPath]) : _ancestorChain(p, rootPath);
    });
  }, [rootPath]);

  const noChildren =
    !tree || !('children' in tree) || ((tree as DirNode).children?.length ?? 0) === 0;

  return (
    <Pane paneClass="tree-pane" title="Explorer" onClose={onClose}>
      {noChildren ? (
        <PaneEmpty
          icon={FolderOpen}
          title={tree?.name ? 'Empty repository' : 'No project loaded'}
          sub={tree?.name ? 'This project has no files yet.' : 'Open one to explore its file tree.'}
        />
      ) : (
        <ul class="tree-list tree-root">
          <TreeItem
            node={tree as TreeNode}
            isRoot
            rootPath={rootPath}
            expanded={expanded}
            selectedPath={selectedPath}
            hoveredPath={hoveredPath}
            onSelect={onSelect}
            onFocus={onFocus}
            onHover={onHover}
            onHoverEnd={onHoverEnd}
          />
        </ul>
      )}
    </Pane>
  );
}

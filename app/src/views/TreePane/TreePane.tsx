// views/TreePane.tsx — the Explore pane's "File tree" subtab body. Renders a
// collapsible folder/file tree that mirrors the city's layout
// (alphabetical, files+dirs intermingled — see layout.js _layoutDir)
// and stays bidirectionally synced with the scene's current selection.
// Body-only — ExplorePane owns the Pane chrome + tab strip.
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
import { FolderOpen } from 'lucide-preact';
import { NodeIcon } from '@/components/NodeIcon/NodeIcon';
import { PaneEmpty } from '@/components/Pane';

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
  rootPath: string;
  expanded: Signal<Set<string>>;
  selectedPath: ReadonlySignal<string | null>;
  hoveredPath: ReadonlySignal<string | null>;
  onSelect?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

function TreeItem({
  node,
  rootPath,
  expanded,
  selectedPath,
  hoveredPath,
  onSelect,
  onHover,
  onHoverEnd,
}: TreeItemProps) {
  const isDir = node.type === NodeKind.Directory;
  const path = node.path ?? '';
  // .value reads track the signal so the row re-renders on each change.
  const isExpanded = isDir && expanded.value.has(path);
  const isSelected = selectedPath.value === path;
  const isHovered = hoveredPath.value === path;
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

  function handleClick() {
    if (isDir && isExpanded) {
      // Collapse this folder. Don't also select it: selection drives the
      // ancestor-chain expansion bridge, which would immediately reopen it.
      const next = new Set(expanded.value);
      next.delete(path);
      expanded.value = next;
      return;
    }
    if (isDir) {
      // Open this branch, enforcing the single-branch invariant (siblings
      // close). Set expansion directly rather than leaning on the selection
      // bridge, so an already-selected folder still reopens after a collapse.
      expanded.value = new Set([..._ancestorChain(path, rootPath), path]);
    }
    onSelect?.(node);
  }

  const classes: string[] = ['tree-item'];
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
          handleClick();
        }}
        onMouseEnter={() => onHover?.(node)}
        onMouseLeave={() => onHoverEnd?.(node)}
      >
        {/* No disclosure chevron (Zed-style): a directory row toggles on click,
            and its open/closed folder icon is the expansion cue. Files and dirs
            both lead with the icon, so sibling icons line up. */}
        <NodeIcon node={node} open={isExpanded} />
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
  onSelect?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

export function TreePane({
  manifest,
  selectedPath,
  hoveredPath,
  expanded,
  rootPath,
  onSelect,
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

  if (noChildren) {
    return (
      <PaneEmpty
        icon={FolderOpen}
        title={tree?.name ? 'Empty repository' : 'No project loaded'}
        sub={tree?.name ? 'This project has no files yet.' : 'Open one to explore its file tree.'}
      />
    );
  }
  return (
    <ul class="tree-list tree-root">
      {_sortChildren((tree as DirNode).children).map((child) => (
        <TreeItem
          key={child.path ?? child.name}
          node={child}
          rootPath={rootPath}
          expanded={expanded}
          selectedPath={selectedPath}
          hoveredPath={hoveredPath}
          onSelect={onSelect}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
        />
      ))}
    </ul>
  );
}

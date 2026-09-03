// panes/ExplorePane/tabs/TreeTab — the File tree tab: a collapsible tree
// mirroring the city's layout, synced both ways with the scene's selection.
// Single-branch invariant: one chain from the root is exposed at a time, so
// expanding a dir closes every other branch.

import { type DirNode, type Manifest, NodeKind, type TreeNode } from '@codecity/city';
import './TreeTab.css';
import { effect, useComputed, type ReadonlySignal, type Signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { FolderOpen } from 'lucide-preact';
import { NodeIcon } from '@/features/city/components/NodeIcon/NodeIcon';
import { PaneEmpty } from '@/components/PaneEmpty/PaneEmpty';

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

/** Visible treeitems in DOM order. Collapsed subtrees aren't rendered, so every
 *  rendered treeitem is a visible one — arrow-key nav just walks this list. */
function _visibleItems(from: HTMLElement): HTMLElement[] {
  const root = from.closest('[role="tree"]');
  return root ? Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]')) : [];
}
function _focusSibling(current: HTMLElement, delta: number) {
  const items = _visibleItems(current);
  const i = items.indexOf(current);
  if (i !== -1) items[i + delta]?.focus();
}

// ── Item component ──────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  rootPath: string;
  /** Path of the first root item. The roving-tabindex entry point is the
   *  selected item, or this one when nothing is selected. */
  firstPath: string;
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
  firstPath,
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

  // Only on becoming selected: scrollIntoView is a no-op for a row already in
  // view, so re-renders of the same selection stay silent.
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
      // Set directly rather than through the selection bridge, so an
      // already-selected folder still reopens after a collapse.
      expanded.value = new Set([..._ancestorChain(path, rootPath), path]);
    }
    onSelect?.(node);
  }

  function onKeyDown(e: KeyboardEvent) {
    // Keydown bubbles through ancestor treeitems, whose handlers would re-run
    // and hijack focus: only the focused item acts on its own keys.
    if (e.target !== e.currentTarget) return;
    const li = e.currentTarget as HTMLElement;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleClick();
        break;
      case 'ArrowDown':
        e.preventDefault();
        _focusSibling(li, 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        _focusSibling(li, -1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (isDir && !isExpanded)
          handleClick(); // expand this branch
        else if (isDir && isExpanded) _focusSibling(li, 1); // step into first child
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (isDir && isExpanded)
          handleClick(); // collapse (handleClick returns early, focus stays)
        else (li.parentElement?.closest('[role="treeitem"]') as HTMLElement | null)?.focus();
        break;
      case 'Home':
        e.preventDefault();
        _visibleItems(li)[0]?.focus();
        break;
      case 'End': {
        e.preventDefault();
        const items = _visibleItems(li);
        items[items.length - 1]?.focus();
        break;
      }
    }
  }

  const classes: string[] = ['tree-item'];
  if (isDir) classes.push('tree-dir', isExpanded ? 'tree-expanded' : 'tree-collapsed');
  else classes.push('tree-file');
  if (isSelected) classes.push('tree-selected');
  if (isHovered) classes.push('tree-hovered');

  const children = isDir ? _sortChildren((node as DirNode).children) : [];
  // Roving tabindex: exactly one item is a Tab stop — the selected one, or the
  // first item when the tree has no selection yet. Arrow keys move focus within.
  const isTabStop = isSelected || (selectedPath.value == null && path === firstPath);

  return (
    <li
      ref={ref}
      class={classes.join(' ')}
      data-path={path}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={isDir ? isExpanded : undefined}
      tabIndex={isTabStop ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        e.stopPropagation();
        handleClick();
      }}
    >
      <div
        class="row row--tight"
        onMouseEnter={() => onHover?.(node)}
        onMouseLeave={() => onHoverEnd?.(node)}
      >
        {/* No chevron: the open/closed folder icon is the expansion cue, and
            leading with it lines every sibling icon up. */}
        <NodeIcon node={node} open={isExpanded} />
        <span class="tree-label">{node.name || ''}</span>
      </div>
      {isDir && isExpanded && children.length > 0 && (
        <ul class="tree-list" role="group">
          {children.map((child) => (
            <TreeItem
              key={child.path ?? child.name}
              node={child}
              rootPath={rootPath}
              firstPath={firstPath}
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

export interface TreeTabProps {
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;
  selectedPath: ReadonlySignal<string | null>;
  hoveredPath: ReadonlySignal<string | null>;
  /** Expanded directory paths, read and written by the tab. The
   *  selection→expansion bridge lives outside, so it wires up synchronously. */
  expanded: Signal<Set<string>>;
  rootPath: string;
  onSelect?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

export function TreeTab({
  manifest,
  selectedPath,
  hoveredPath,
  expanded,
  rootPath,
  onSelect,
  onHover,
  onHoverEnd,
}: TreeTabProps) {
  const treeSig = useComputed(() => _treeRoot(manifest));
  const tree = treeSig.value;

  // Selection → expansion bridge, in an effect so the ancestor chain opens
  // whenever the picker's selection moves.
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
  const roots = _sortChildren((tree as DirNode).children);
  const firstPath = roots[0]?.path ?? '';
  return (
    <ul class="tree-list tree-root" role="tree" aria-label="File tree">
      {roots.map((child) => (
        <TreeItem
          key={child.path ?? child.name}
          node={child}
          rootPath={rootPath}
          firstPath={firstPath}
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

// views/panes/TreePane.tsx — Left sidebar tree view. Renders a
// collapsible folder/file tree that mirrors the city's layout
// (alphabetical, files+dirs intermingled — see layout.js _layoutDir)
// and stays bidirectionally synced with the scene's current selection.
//
// Single-branch invariant: only one chain from the root is ever
// exposed at a time. Expanding a dir closes every other branch;
// selection-driven highlight (from the city) expands the ancestor
// chain of the selected node.

import { render } from 'preact';
import { computed, effect, signal, useComputed } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest, TreeNode } from '@/types';
import { LucideIcon } from '@/views/components/LucideIcon';
import { GemIcon } from '@/views/components/GemIcon';
import { FileIcon } from '@/views/components/FileIcon';
import { FolderIcon } from '@/views/components/FolderIcon';
import { PaneHeader } from '@/views/components/PaneHeader';

// ── Helpers ──────────────────────────────────────────────────────────

function _treeRoot(m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null): TreeNode | null {
  if (!m) return null;
  return (('tree' in m && (m as Manifest).tree) || (m as TreeNode));
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
            <LucideIcon
              name={isExpanded ? 'chevron-down' : 'chevron-right'}
              class="tree-icon tree-icon-dir"
            />
          </span>
        ) : (
          <span class="tree-chevron">
            {isDir && isRoot && (
              <LucideIcon name="chevron-down" class="tree-icon tree-icon-dir" />
            )}
          </span>
        )}
        {/* Glyph: root uses the brand gem (monochrome); other dirs the
            Material folder icon; files the Material file icon. */}
        {isDir
          ? isRoot
            ? <GemIcon simple class="tree-root-glyph" />
            : <FolderIcon dir={node as DirNode} />
          : <FileIcon file={node as FileNode} />}
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
  // buildTreePane (the imperative shim) sets up its own pre-mount
  // bridge for tests — this effect is idempotent on top of that.
  useEffect(() => {
    function apply() {
      const p = selectedPath.value;
      expanded.value = p == null ? new Set([rootPath]) : _ancestorChain(p, rootPath);
    }
    apply();
    const unsubSel = selectedPath.subscribe(apply);
    return unsubSel;
  }, [rootPath]);

  const noChildren = !tree || !('children' in tree) || ((tree as DirNode).children?.length ?? 0) === 0;

  return (
    <div class="pane tree-pane">
      <PaneHeader title="Explorer" onClose={onClose} />
      {noChildren ? (
        <div class="empty-state empty-state--lg">
          <LucideIcon name="folder-open" />
          {tree?.name ? (
            <>
              <p class="text-card-title">Empty repository</p>
              <p class="text-card-sub">This project has no files yet.</p>
            </>
          ) : (
            <>
              <p class="text-card-title">No project loaded</p>
              <p class="text-card-sub">Open one to explore its file tree.</p>
            </>
          )}
        </div>
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
    </div>
  );
}

// ── Imperative shim ─────────────────────────────────────────────────
// LeftSidebar still mounts panes as HTMLElements. The shim renders
// <TreePane /> into a host div, returns the inner element, and exposes
// an api compatible with the previous buildTreePane signature.
//
// #35 will port LeftSidebar to Preact, at which point this shim can be
// deleted per #10.

interface BuildTreePaneOpts {
  onClose?: () => void;
  onSelect?: (node: TreeNode) => void;
  onFocus?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

export interface TreePaneApi {
  setSelectedPath(path: string | null): void;
  setHoveredPath(path: string | null): void;
  setManifest(m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown }): void;
}

export function buildTreePane(
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown },
  opts: BuildTreePaneOpts = {}
): { pane: HTMLElement; api: TreePaneApi } {
  const manifestSig = signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>(manifest);
  const selectedPath = signal<string | null>(null);
  const hoveredPath = signal<string | null>(null);

  // Root path may change when the manifest swaps. Derive it via a
  // computed so the bridge effect re-binds on swap.
  const rootPathSig = computed(() => _treeRoot(manifestSig.value)?.path ?? '');

  // Expansion state is shared between the user (chevron clicks) and the
  // selection bridge (which forces the ancestor chain open when
  // selectedPath changes). Initial: just the root.
  const expanded = signal<Set<string>>(new Set([rootPathSig.value]));

  // Bridge: any change to selectedPath or rootPath rewrites the expanded
  // set to the new ancestor chain. Wired up synchronously here (not via
  // useEffect inside the component) so the subscription is live before
  // the first setSelectedPath call from test code.
  effect(() => {
    const p = selectedPath.value;
    const root = rootPathSig.value;
    expanded.value = p == null ? new Set([root]) : _ancestorChain(p, root);
  });

  const host = document.createElement('div');
  render(
    <TreePane
      manifest={manifestSig}
      selectedPath={selectedPath}
      hoveredPath={hoveredPath}
      expanded={expanded}
      rootPath={rootPathSig.value}
      onClose={opts.onClose}
      onSelect={opts.onSelect}
      onFocus={opts.onFocus}
      onHover={opts.onHover}
      onHoverEnd={opts.onHoverEnd}
    />,
    host
  );
  const pane = host.firstElementChild as HTMLElement;

  return {
    pane,
    api: {
      setSelectedPath(path) {
        selectedPath.value = path;
      },
      setHoveredPath(path) {
        hoveredPath.value = path;
      },
      setManifest(m) {
        manifestSig.value = m;
      },
    },
  };
}

// ── Bare-tree helper (used by tests) ────────────────────────────────
// Returns a <ul> for `node`'s children with all directories expanded,
// no event handlers, no selection/hover binding. Test fixtures use this
// to assert DOM structure independent of the live <TreePane>'s
// expansion state. Production callers should use buildTreePane to get
// the click/dblclick handlers + selection api wired up.
//
// Renders directly via Preact into a detached <ul> so the markup matches
// what <TreePane> produces — same classes, same structure, just every
// directory pre-expanded.

export function buildTree(
  node: TreeNode | DirNode | { children?: unknown[]; [k: string]: unknown }
): HTMLUListElement {
  // expanded contains EVERY descendant dir path so the recursive render
  // walks the entire tree.
  const expandedPaths = new Set<string>();
  function _collectDirPaths(n: TreeNode): void {
    if (n.type === NodeKind.Directory) {
      if (n.path != null) expandedPaths.add(n.path);
      for (const c of (n as DirNode).children ?? []) _collectDirPaths(c);
    }
  }
  _collectDirPaths(node as TreeNode);

  const expanded = signal(expandedPaths);
  const selectedPath = signal<string | null>(null);
  const hoveredPath = signal<string | null>(null);
  const rootPath = (node as TreeNode).path ?? '';

  // We need a <ul> top-level matching `class="tree-list"` — render
  // TreeItem inside one and return that ul.
  const host = document.createElement('div');
  const children = _sortChildren(
    'children' in node ? (node as DirNode).children : []
  );
  render(
    <ul class="tree-list">
      {children.map((child) => (
        <TreeItem
          key={child.path ?? child.name}
          node={child}
          rootPath={rootPath}
          expanded={expanded}
          selectedPath={selectedPath}
          hoveredPath={hoveredPath}
        />
      ))}
    </ul>,
    host
  );
  return host.firstElementChild as HTMLUListElement;
}

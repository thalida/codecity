// views/panes/treePane.js — Left sidebar tree view. Renders a collapsible
// folder/file tree that mirrors the city's layout (alphabetical,
// files+dirs intermingled — see layout.js _layoutDir) and stays
// bidirectionally synced with the scene's current selection.

import { NodeKind } from '@/types';
import type { DirNode, Manifest, TreeNode } from '@/types';
import { makeLucideIcon } from '@/views/shell/icon.js';
import { makeFileIcon, makeFolderIcon } from '@/views/shell/fileIcon.js';
import { buildPaneHeader } from '@/views/shell/paneHeader.js';

interface TreeCtx {
  byPath: Record<string, { li: HTMLLIElement; node: TreeNode }>;
  rootList: HTMLUListElement | null;
  rootDirLi: HTMLLIElement | null;
  onSelect?: ((node: TreeNode) => void) | null;
  onFocus?: ((node: TreeNode) => void) | null;
  onHover?: ((node: TreeNode) => void) | null;
  onHoverEnd?: ((node: TreeNode) => void) | null;
}

// Build a <ul> for `node`'s children. `ctx` carries the per-tree mutable
// state (path → li registry, callbacks). `node` is the tree node being
// expanded; pass the manifest root to start.
function _buildList(node: DirNode | TreeNode, ctx: TreeCtx): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = 'tree-list';

  // Match layout.js sort: alphabetical, files + directories intermingled.
  // Keeps the tree's visual order identical to the city's road layout.
  const rawChildren =
    'children' in node && Array.isArray((node as DirNode).children)
      ? (node as DirNode).children
      : [];
  const children = rawChildren.slice().sort((a, b) => {
    return (a.name || '').localeCompare(b.name || '');
  });

  for (let i = 0; i < children.length; i++) {
    ul.appendChild(_buildItem(children[i], ctx));
  }

  return ul;
}

function _buildItem(child: TreeNode, ctx: TreeCtx, isRoot = false): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'tree-item';
  if (isRoot) li.classList.add('tree-root-item');
  if (child.path != null) li.dataset.path = child.path;

  const row = document.createElement('div');
  row.className = 'tree-row';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = child.name || '';

  if (child.type === NodeKind.Directory) {
    // Root starts expanded and stays that way — there's no parent to
    // navigate up to, so collapsing the root is a dead-end gesture.
    // Children start collapsed (single-branch invariant).
    li.classList.add('tree-dir', isRoot ? 'tree-expanded' : 'tree-collapsed');

    // Chevron flips between right (collapsed) and down (expanded). Both
    // share the same icon span so we just swap the mask URL on toggle.
    // On root the chevron is hidden via CSS but the element stays in
    // the DOM so _setDirExpanded's selector still finds it.
    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    const chevronIcon = makeLucideIcon(isRoot ? 'chevron-down' : 'chevron-right', {
      class: 'tree-icon tree-icon-dir',
    });
    chevron.appendChild(chevronIcon);
    row.appendChild(chevron);
    // Folder glyph sits between the chevron and the label so the row
    // reads "[state arrow] [folder icon] [name]". The icon is picked
    // by directory name (src/, tests/, views/, …) when we recognize
    // it, generic folder otherwise.
    row.appendChild(makeFolderIcon(child as DirNode));
    row.appendChild(label);
    li.appendChild(row);

    const subtree = _buildList(child as DirNode, ctx);
    subtree.style.display = isRoot ? '' : 'none';
    li.appendChild(subtree);

    if (!isRoot) {
      chevron.addEventListener('click', (e) => {
        e.stopPropagation(); // selecting via the chevron is intentionally a no-op
        // Single-branch invariant: expanding a directory closes any other
        // open branch so only one chain from root is ever exposed at a time.
        // Collapsing only collapses this dir — invariant trivially holds.
        const isCollapsed = li.classList.contains('tree-collapsed');
        if (isCollapsed) _openOnlyChain(li, ctx.rootList);
        else _collapseDir(li, subtree, chevronIcon);
      });
    }
  } else {
    li.classList.add('tree-file');
    row.appendChild(makeFileIcon(child));
    row.appendChild(label);
    li.appendChild(row);
  }

  if (child.path != null) ctx.byPath[child.path] = { li, node: child };

  // Single click selects, double click focuses — mirrors the canvas
  // pointerup + dblclick handlers in main.js. The browser fires both
  // click events that make up a dblclick, which is fine: select is
  // idempotent, then focus runs on top.
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof ctx.onSelect === 'function') ctx.onSelect(child);
  });
  row.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (typeof ctx.onFocus === 'function') ctx.onFocus(child);
  });
  // Hover mirrors into the city. mouseenter/mouseleave (not mouseover/out)
  // because they don't bubble: each row owns its own hover signal so
  // moving row→row produces a clean leave-then-enter pair without the
  // child-element churn pointerover sees.
  row.addEventListener('mouseenter', () => {
    if (typeof ctx.onHover === 'function') ctx.onHover(child);
  });
  row.addEventListener('mouseleave', () => {
    if (typeof ctx.onHoverEnd === 'function') ctx.onHoverEnd(child);
  });

  return li;
}

function _expandDir(li: HTMLElement, subtree: HTMLElement, chevronIcon: HTMLElement): void {
  li.classList.remove('tree-collapsed');
  li.classList.add('tree-expanded');
  subtree.style.display = '';
  _setIcon(chevronIcon, 'chevron-down');
}

function _collapseDir(li: HTMLElement, subtree: HTMLElement, chevronIcon: HTMLElement): void {
  li.classList.add('tree-collapsed');
  li.classList.remove('tree-expanded');
  subtree.style.display = 'none';
  _setIcon(chevronIcon, 'chevron-right');
}

// _ancestorChain(li, root) -> Set<HTMLElement>
//
// Returns the set of <li class="tree-dir"> elements that are on the path
// from `li` up to (and not including) `root`'s parent. Used by
// _openOnlyChain to know which dirs to spare from the bulk collapse.
function _ancestorChain(li: HTMLElement, root: HTMLElement): Set<HTMLElement> {
  const chain = new Set<HTMLElement>();
  let p = li.parentElement;
  while (p && p !== root) {
    if (p.classList && p.classList.contains('tree-list')) {
      const parentLi = p.parentElement;
      if (parentLi && parentLi.classList.contains('tree-dir')) chain.add(parentLi);
    }
    p = p.parentElement;
  }
  return chain;
}

// _openOnlyChain(target, rootList) — enforce the "one open branch" rule:
// collapse every dir not on `target`'s ancestor chain, expand the chain,
// and (if `target` is itself a dir) expand it too. The selected dir's
// contents should be visible — that's the user's "current branch".
function _openOnlyChain(target: HTMLElement, rootList: HTMLElement | null): void {
  if (!rootList) return;
  const chain = _ancestorChain(target, rootList);
  const allDirs = rootList.querySelectorAll<HTMLElement>('.tree-dir');
  for (let i = 0; i < allDirs.length; i++) {
    const dirLi = allDirs[i];
    const shouldBeExpanded = chain.has(dirLi) || dirLi === target;
    _setDirExpanded(dirLi, shouldBeExpanded);
  }
}

// _setDirExpanded(li, expanded) — apply expand/collapse to a directory <li>
// without callers needing to look up its own subtree + chevron icon.
function _setDirExpanded(li: HTMLElement, expanded: boolean): void {
  const sub = li.querySelector<HTMLElement>(':scope > .tree-list');
  const chev = li.querySelector<HTMLElement>(':scope > .tree-row > .tree-chevron > .tree-icon');
  if (!sub || !chev) return;
  if (expanded) {
    if (li.classList.contains('tree-expanded')) return;
    _expandDir(li, sub, chev);
  } else {
    if (li.classList.contains('tree-collapsed')) return;
    _collapseDir(li, sub, chev);
  }
}

// _setIcon(span, name) — swap the mask-image URL of an existing lucide-icon
// span so we don't have to rebuild the DOM node on every toggle.
function _setIcon(span: HTMLElement, name: string): void {
  const base = span.style.maskImage || span.style.webkitMaskImage;
  // Both URLs share the prefix up through ".../icons/"; swap the last segment.
  const u = base.replace(/[^/]+\.svg/, `${name}.svg`);
  span.style.maskImage = u;
  span.style.webkitMaskImage = u;
}

// buildTree(node) — bare <ul> for `node`'s children with no event handlers.
// Used by tests; production callers should use buildTreePane to get the
// click/dblclick handlers + selection api wired up.
export function buildTree(
  node: TreeNode | DirNode | { children?: unknown[]; [k: string]: unknown }
): HTMLUListElement {
  return _buildList(node as DirNode, {
    byPath: {},
    rootList: null,
    rootDirLi: null,
    onSelect: null,
    onFocus: null,
  });
}

// buildTreePane(manifest, opts) -> { pane, api }
//
// Returns the Tree tab's content as a DOM element plus a small API for the
// caller to drive selection / hover state into the tree (so a click or
// hover on a building in the city can highlight the matching row).
//
// opts.onClose      — fn() when the user clicks the × in the header.
// opts.onSelect     — fn(node) for single-click on a row (file or directory).
// opts.onFocus      — fn(node) for double-click on a row.
// opts.onHover      — fn(node) when the cursor enters a row.
// opts.onHoverEnd   — fn(node) when the cursor leaves a row.
//
// api.setSelectedPath(path) — highlight the row matching `path` (or clear
//                             if path is null). Enforces the single-branch-
//                             open rule: only the ancestor chain of the
//                             selected row stays open; everything else
//                             collapses. Scrolls the row into view.
// api.setHoveredPath(path)  — apply the .tree-hovered class to the row
//                             matching `path` (or clear if null). Does not
//                             change expansion — hover is a transient
//                             cosmetic mirror, not a navigation gesture.
interface BuildTreePaneOpts {
  onClose?: () => void;
  onSelect?: (node: TreeNode) => void;
  onFocus?: (node: TreeNode) => void;
  onHover?: (node: TreeNode) => void;
  onHoverEnd?: (node: TreeNode) => void;
}

export function buildTreePane(
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown },
  opts: BuildTreePaneOpts = {}
) {
  const pane = document.createElement('div');
  pane.className = 'left-pane tree-pane';

  // Generic "Explorer" label so it doesn't duplicate the root folder name
  // shown right below it in the list (mirrors VSCode's section header).
  const { el: header } = buildPaneHeader({ title: 'Explorer', onClose: opts.onClose });
  pane.appendChild(header);

  const ctx: TreeCtx = {
    byPath: {},
    rootList: null, // populated below; chevron click reads it
    rootDirLi: null, // set after the root folder li is built
    onSelect: opts.onSelect,
    onFocus: opts.onFocus,
    onHover: opts.onHover,
    onHoverEnd: opts.onHoverEnd,
  };

  // Wrap the manifest root in a single top-level folder li (instead of
  // splatting its children into the list) so the project root is itself
  // hoverable / selectable / focusable. Hovering or selecting the root
  // street in the city now has a matching row to highlight.
  const m = manifest as { tree?: unknown };
  const tree = (m.tree || manifest) as TreeNode;
  const listEl = document.createElement('ul');
  listEl.className = 'tree-list tree-root';
  ctx.rootList = listEl;
  const rootItem = _buildItem(tree, ctx, true);
  ctx.rootDirLi = rootItem;
  listEl.appendChild(rootItem);
  pane.appendChild(listEl);

  let currentSelectedLi: HTMLLIElement | null = null;
  let currentHoveredLi: HTMLLIElement | null = null;

  // Rebuild the tree DOM from a fresh manifest. Used after applyManifest
  // swaps in a new tree (e.g. SHOW_ALL_FILES toggle, live-update poll
  // picking up new files). Without this the sidebar shows the snapshot
  // captured at init and silently drifts from the city.
  function setManifest(m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown }): void {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    for (const k of Object.keys(ctx.byPath)) delete ctx.byPath[k];
    currentSelectedLi = null;
    currentHoveredLi = null;
    const next = ((m as { tree?: unknown }).tree || m) as TreeNode;
    const nextRoot = _buildItem(next, ctx, true);
    ctx.rootDirLi = nextRoot;
    listEl.appendChild(nextRoot);
  }

  function setSelectedPath(path: string | null): void {
    if (currentSelectedLi) {
      currentSelectedLi.classList.remove('tree-selected');
      currentSelectedLi = null;
    }
    if (path == null) {
      // No selection → root stays open as the project's entry point;
      // every other branch collapses (single-branch invariant).
      if (ctx.rootDirLi) _openOnlyChain(ctx.rootDirLi, listEl);
      return;
    }
    const entry = ctx.byPath[path];
    if (!entry) return;
    entry.li.classList.add('tree-selected');
    currentSelectedLi = entry.li;
    _openOnlyChain(entry.li, listEl);
    // scrollIntoView with nearest avoids scroll-jumping when the row is
    // already visible (common for click-driven selection from the city).
    if (typeof entry.li.scrollIntoView === 'function') {
      entry.li.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function setHoveredPath(path: string | null): void {
    if (currentHoveredLi) {
      currentHoveredLi.classList.remove('tree-hovered');
      currentHoveredLi = null;
    }
    if (path == null) return;
    const entry = ctx.byPath[path];
    if (!entry) return;
    entry.li.classList.add('tree-hovered');
    currentHoveredLi = entry.li;
  }

  return {
    pane,
    api: {
      setSelectedPath,
      setHoveredPath,
      setManifest,
    },
  };
}


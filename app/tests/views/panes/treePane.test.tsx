import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { TreePane } from '@/views/TreePane';
import type { Manifest, DirNode, TreeNode } from '@/types';
import { flush } from '../../_helpers/preact';

type TreeLike = Manifest | DirNode | { tree?: unknown; [k: string]: unknown };

const TEST_TREE = {
  name: 'project',
  type: 'directory',
  path: '.',
  children_count: 3,
  children_file_count: 2,
  children_dir_count: 1,
  descendants_count: 4,
  descendants_file_count: 3,
  descendants_dir_count: 1,
  descendants_size: 5000,
  children: [
    { name: 'index.ts', type: 'file', path: 'index.ts', extension: '.ts', size: 2000, lines: 80 },
    { name: 'README.md', type: 'file', path: 'README.md', extension: '.md', size: 500, lines: 20 },
    {
      name: 'src',
      type: 'directory',
      path: 'src',
      children_count: 1,
      children_file_count: 1,
      children_dir_count: 0,
      descendants_count: 1,
      descendants_file_count: 1,
      descendants_dir_count: 0,
      descendants_size: 800,
      children: [
        {
          name: 'utils.ts',
          type: 'file',
          path: 'src/utils.ts',
          extension: '.ts',
          size: 800,
          lines: 30,
        },
      ],
    },
  ],
};

// ---- TreePane ----
describe('TreePane', () => {
  let container: HTMLDivElement;
  let manifest: ReturnType<typeof signal<TreeLike | null>>;
  let selectedPath: ReturnType<typeof signal<string | null>>;
  let hoveredPath: ReturnType<typeof signal<string | null>>;
  let expanded: ReturnType<typeof signal<Set<string>>>;

  interface MountOpts {
    onClose?: () => void;
    onSelect?: (node: TreeNode) => void;
    onFocus?: (node: TreeNode) => void;
    onHover?: (node: TreeNode) => void;
    onHoverEnd?: (node: TreeNode) => void;
  }

  // Renders <TreePane> into the test container with fresh signals and
  // returns the `.pane` element (mirrors the old buildTreePane().pane).
  function mount(initialManifest: TreeLike, opts: MountOpts = {}): HTMLElement {
    manifest = signal<TreeLike | null>(initialManifest);
    selectedPath = signal<string | null>(null);
    hoveredPath = signal<string | null>(null);
    const rootPath = ((initialManifest as { tree?: { path?: string }; path?: string }).tree?.path ??
      (initialManifest as { path?: string }).path ??
      '.') as string;
    // Seed expansion with the root path so the root's children render on
    // the first synchronous pass (matches the component's mount-time
    // selection→expansion bridge, which fires the same value). Tests that
    // don't flush before querying rely on the root being expanded already.
    expanded = signal<Set<string>>(new Set([rootPath]));
    // act() flushes Preact's effect queue synchronously, so the
    // component's selection→expansion bridge (an effect installed via
    // useEffect) is live before tests mutate selectedPath. Without it the
    // bridge wouldn't run until a later rAF/timeout tick.
    act(() => {
      render(
        <TreePane
          manifest={manifest}
          selectedPath={selectedPath}
          hoveredPath={hoveredPath}
          expanded={expanded}
          rootPath={rootPath}
          onClose={opts.onClose}
          onSelect={opts.onSelect}
          onFocus={opts.onFocus}
          onHover={opts.onHover}
          onHoverEnd={opts.onHoverEnd}
        />,
        container
      );
    });
    return container.querySelector('.pane') as HTMLElement;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('clicking the chevron expands and collapses the directory', async () => {
    const pane = mount(TEST_TREE);
    const dir = pane.querySelector<HTMLElement>('.tree-dir:not(.tree-root-item)');
    expect(dir).not.toBeNull();
    const chevron = dir!.querySelector<HTMLElement>(':scope > .row > .tree-chevron');
    expect(chevron).not.toBeNull();

    expect(dir!.classList.contains('tree-collapsed')).toBe(true);
    expect(dir!.querySelector(':scope > .tree-list')).toBeNull();

    chevron!.click();
    await flush();

    const expandedDir = pane.querySelector<HTMLElement>('[data-path="src"]')!;
    expect(expandedDir.classList.contains('tree-expanded')).toBe(true);
    expect(expandedDir.querySelector(':scope > .tree-list')).not.toBeNull();

    const expandedChevron = expandedDir.querySelector<HTMLElement>(':scope > .row > .tree-chevron')!;
    expandedChevron.click();
    await flush();

    const collapsedDir = pane.querySelector<HTMLElement>('[data-path="src"]')!;
    expect(collapsedDir.classList.contains('tree-collapsed')).toBe(true);
    expect(collapsedDir.querySelector(':scope > .tree-list')).toBeNull();
  });

  it('keeps the root folder permanently expanded (chevron click is a no-op)', () => {
    const pane = mount(TEST_TREE);
    const root = pane.querySelector<HTMLElement>('.tree-root-item');
    expect(root).not.toBeNull();
    expect(root!.classList.contains('tree-expanded')).toBe(true);
    const rootSubtree = root!.querySelector<HTMLElement>(':scope > .tree-list');
    expect(rootSubtree).not.toBeNull();

    // The root chevron has no click handler attached (it's just an
    // indicator), so clicking it has no effect on expansion.
    const rootChevron = root!.querySelector<HTMLElement>(':scope > .row > .tree-chevron')!;
    rootChevron.click();
    const stillRoot = pane.querySelector<HTMLElement>('.tree-root-item')!;
    expect(stillRoot.classList.contains('tree-expanded')).toBe(true);
    expect(stillRoot.querySelector(':scope > .tree-list')).not.toBeNull();
  });

  it('returns a pane with header + tree content', () => {
    const pane = mount({ tree: TEST_TREE });

    expect(pane.classList.contains('pane')).toBe(true);
    expect(pane.classList.contains('tree-pane')).toBe(true);

    const header = pane.querySelector('.pane-header');
    expect(header).not.toBeNull();

    const title = pane.querySelector('.text-pane-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Explorer');

    const items = pane.querySelectorAll<HTMLLIElement>('.tree-item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('accepts a bare tree (no { tree } wrapper)', () => {
    const pane = mount(TEST_TREE);
    const title = pane.querySelector('.text-pane-title');
    expect(title!.textContent).toBe('Explorer');
  });

  it('renders the manifest root as a top-level folder', () => {
    const pane = mount(TEST_TREE);
    const rootList = pane.querySelector('ul.tree-root');
    const topLevelItems = rootList!.querySelectorAll<HTMLLIElement>(':scope > li');
    expect(topLevelItems.length).toBe(1);
    expect(topLevelItems[0].classList.contains('tree-dir')).toBe(true);
    expect(topLevelItems[0].dataset.path).toBe('.');
    expect(topLevelItems[0].querySelector(':scope > .row > .tree-label')!.textContent).toBe(
      'project'
    );
  });

  // Structural assertions migrated from the deleted buildTree helper. They
  // exercise the same render path via the live <TreePane> instead of a
  // test-only bare-tree builder exported from production.
  it('sorts top-level children alphabetically (files + dirs intermingled)', () => {
    const pane = mount(TEST_TREE);
    const rootChildList = pane.querySelector('ul.tree-root > li > .tree-list')!;
    const labels = rootChildList.querySelectorAll<HTMLElement>(':scope > li > .row > .tree-label');
    const names = Array.from(labels, (el) => el.textContent);
    expect(names).toEqual(['index.ts', 'README.md', 'src']);
  });

  it('renders every file across nesting once its branch is expanded', async () => {
    const pane = mount(TEST_TREE);
    // Selecting into src expands its ancestor chain, surfacing src/utils.ts
    // alongside the two top-level files. (Single-branch-open, so for a
    // fixture with one nested dir this is the whole tree.)
    selectedPath.value = 'src/utils.ts';
    await flush();
    expect(pane.querySelectorAll('.tree-file').length).toBe(3);
  });

  it('with no selection, only the root folder is expanded', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = null;
    await flush();
    const expandedDirs = pane.querySelectorAll<HTMLLIElement>('.tree-dir.tree-expanded');
    expect(expandedDirs.length).toBe(1);
    expect(expandedDirs[0].dataset.path).toBe('.');
  });

  it('row click invokes onSelect with the node', () => {
    let picked: TreeNode | null = null;
    const pane = mount(TEST_TREE, {
      onSelect(node) {
        picked = node;
      },
    });
    const fileRow = pane.querySelector<HTMLElement>('.tree-file > .row')!;
    fileRow.click();
    expect(picked).not.toBeNull();
    expect(picked!.type).toBe('file');
  });

  it('row dblclick invokes onFocus with the node', () => {
    let focused: TreeNode | null = null;
    const pane = mount(TEST_TREE, {
      onFocus(node) {
        focused = node;
      },
    });
    const fileRow = pane.querySelector<HTMLElement>('.tree-file > .row')!;
    const ev = new window.MouseEvent('dblclick', { bubbles: true, cancelable: true });
    fileRow.dispatchEvent(ev);
    expect(focused).not.toBeNull();
    expect(focused!.type).toBe('file');
  });

  it('setSelectedPath highlights the matching row and expands ancestors', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = 'src/utils.ts';
    await flush();

    const srcDir = pane.querySelector('[data-path="src"]')!;
    expect(srcDir.classList.contains('tree-expanded')).toBe(true);

    const leaf = pane.querySelector('[data-path="src/utils.ts"]')!;
    expect(leaf.classList.contains('tree-selected')).toBe(true);
  });

  it('setSelectedPath(null) clears the highlight and collapses non-root branches', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = 'src/utils.ts';
    await flush();
    expect(pane.querySelector('[data-path="src"]')!.classList.contains('tree-expanded')).toBe(true);

    selectedPath.value = null;
    await flush();
    expect(pane.querySelectorAll('.tree-selected').length).toBe(0);
    expect(pane.querySelector('[data-path="src"]')!.classList.contains('tree-collapsed')).toBe(true);
    expect(pane.querySelector('[data-path="."]')!.classList.contains('tree-expanded')).toBe(true);
  });

  it('setSelectedPath enforces the single-branch-open invariant', async () => {
    const multiBranch = {
      name: 'project',
      type: 'directory',
      path: '.',
      children: [
        {
          name: 'a',
          type: 'directory',
          path: 'a',
          children: [{ name: 'a1.ts', type: 'file', path: 'a/a1.ts' }],
        },
        {
          name: 'b',
          type: 'directory',
          path: 'b',
          children: [{ name: 'b1.ts', type: 'file', path: 'b/b1.ts' }],
        },
      ],
    };
    const pane = mount(multiBranch);
    selectedPath.value = 'a/a1.ts';
    await flush();
    expect(pane.querySelector('[data-path="a"]')!.classList.contains('tree-expanded')).toBe(true);
    expect(pane.querySelector('[data-path="b"]')!.classList.contains('tree-collapsed')).toBe(true);

    selectedPath.value = 'b/b1.ts';
    await flush();
    expect(pane.querySelector('[data-path="b"]')!.classList.contains('tree-expanded')).toBe(true);
    expect(pane.querySelector('[data-path="a"]')!.classList.contains('tree-collapsed')).toBe(true);
  });

  it('expanding a directory via the chevron closes other open branches', async () => {
    const multiBranch = {
      name: 'project',
      type: 'directory',
      path: '.',
      children: [
        {
          name: 'a',
          type: 'directory',
          path: 'a',
          children: [{ name: 'a1.ts', type: 'file', path: 'a/a1.ts' }],
        },
        {
          name: 'b',
          type: 'directory',
          path: 'b',
          children: [{ name: 'b1.ts', type: 'file', path: 'b/b1.ts' }],
        },
      ],
    };
    const pane = mount(multiBranch);
    const chevA = pane.querySelector<HTMLElement>('[data-path="a"] > .row > .tree-chevron')!;
    chevA.click();
    await flush();
    expect(pane.querySelector('[data-path="a"]')!.classList.contains('tree-expanded')).toBe(true);

    const chevB = pane.querySelector<HTMLElement>('[data-path="b"] > .row > .tree-chevron')!;
    chevB.click();
    await flush();
    expect(pane.querySelector('[data-path="b"]')!.classList.contains('tree-expanded')).toBe(true);
    expect(pane.querySelector('[data-path="a"]')!.classList.contains('tree-collapsed')).toBe(true);
  });

  it('row mouseenter/mouseleave invoke onHover / onHoverEnd', () => {
    let hovered: TreeNode | null = null;
    let ended: TreeNode | null = null;
    const pane = mount(TEST_TREE, {
      onHover(node) {
        hovered = node;
      },
      onHoverEnd(node) {
        ended = node;
      },
    });
    const fileRow = pane.querySelector<HTMLElement>('.tree-file > .row')!;
    fileRow.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
    expect(hovered).not.toBeNull();
    expect(hovered!.type).toBe('file');

    fileRow.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
    expect(ended).not.toBeNull();
  });

  it('setHoveredPath toggles the tree-hovered class', async () => {
    const pane = mount(TEST_TREE);
    hoveredPath.value = 'index.ts';
    await flush();
    expect(pane.querySelector('[data-path="index.ts"]')!.classList.contains('tree-hovered')).toBe(
      true
    );

    hoveredPath.value = null;
    await flush();
    expect(pane.querySelectorAll('.tree-hovered').length).toBe(0);
  });

  it('setHoveredPath does not change directory expansion', async () => {
    // Hover is a transient cosmetic mirror — it must not fight the
    // single-branch-open rule that selection enforces.
    const pane = mount(TEST_TREE);
    const srcDir = pane.querySelector('[data-path="src"]')!;
    expect(srcDir.classList.contains('tree-collapsed')).toBe(true);

    hoveredPath.value = 'src/utils.ts';
    await flush();
    expect(pane.querySelector('[data-path="src"]')!.classList.contains('tree-collapsed')).toBe(true);
  });
});

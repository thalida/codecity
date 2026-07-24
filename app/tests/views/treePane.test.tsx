import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { TreePane } from '@/views/TreePane/TreePane';
import type { Manifest, DirNode, TreeNode } from '@/types';
import { flush } from '../_helpers/preact';

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
    onSelect?: (node: TreeNode) => void;
    onHover?: (node: TreeNode) => void;
    onHoverEnd?: (node: TreeNode) => void;
  }

  // Renders the body-only <TreePane> into the test container with fresh signals
  // and returns the container (TreePane owns no chrome — ExplorePane does).
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
          onSelect={opts.onSelect}
          onHover={opts.onHover}
          onHoverEnd={opts.onHoverEnd}
        />,
        container
      );
    });
    return container;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('clicking a directory row expands then collapses it', async () => {
    const pane = mount(TEST_TREE);
    const dir = pane.querySelector<HTMLElement>('.tree-dir');
    expect(dir).not.toBeNull();

    expect(dir!.classList.contains('tree-collapsed')).toBe(true);
    expect(dir!.querySelector(':scope > .tree-list')).toBeNull();

    dir!.querySelector<HTMLElement>(':scope > .row')!.click();
    await flush();

    const expandedDir = pane.querySelector<HTMLElement>('[data-path="src"]')!;
    expect(expandedDir.classList.contains('tree-expanded')).toBe(true);
    expect(expandedDir.querySelector(':scope > .tree-list')).not.toBeNull();

    expandedDir.querySelector<HTMLElement>(':scope > .row')!.click();
    await flush();

    const collapsedDir = pane.querySelector<HTMLElement>('[data-path="src"]')!;
    expect(collapsedDir.classList.contains('tree-collapsed')).toBe(true);
    expect(collapsedDir.querySelector(':scope > .tree-list')).toBeNull();
  });

  it('renders the tree content as a root list (chrome is ExplorePane’s)', () => {
    const pane = mount({ tree: TEST_TREE });
    expect(pane.querySelector('ul.tree-root')).not.toBeNull();
    const items = pane.querySelectorAll<HTMLLIElement>('.tree-item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('hex is the fallback for an unmatched binary; known types keep their icon', () => {
    const tree = {
      name: 'project',
      type: 'directory',
      path: '.',
      children_count: 4,
      children_file_count: 4,
      children_dir_count: 0,
      descendants_count: 4,
      descendants_file_count: 4,
      descendants_dir_count: 0,
      descendants_size: 0,
      children: [
        { name: 'code.ts', type: 'file', path: 'code.ts', extension: '.ts', size: 100, lines: 10 },
        { name: 'blob.bin', type: 'file', path: 'blob.bin', extension: '.bin', binary: true },
        { name: 'song.mp3', type: 'file', path: 'song.mp3', extension: '.mp3', binary: true },
        {
          name: 'pic.png',
          type: 'file',
          path: 'pic.png',
          extension: '.png',
          binary: true,
          mediaKind: 'image',
        },
      ],
    };
    const pane = mount(tree);
    const icon = (p: string) =>
      pane
        .querySelector<HTMLElement>(`[data-path="${p}"]`)!
        .querySelector('.file-icon')!
        .getAttribute('data-icon-name');
    expect(icon('blob.bin')).toBe('hex'); // unmatched binary → hex fallback
    expect(icon('song.mp3')).toBe('audio'); // known binary type keeps its icon
    expect(icon('code.ts')).not.toBe('hex');
    expect(icon('pic.png')).not.toBe('hex'); // media renders as a billboard
  });

  it('accepts a bare tree (no { tree } wrapper)', () => {
    const pane = mount(TEST_TREE);
    const labels = pane.querySelectorAll<HTMLElement>('ul.tree-root > li > .row > .tree-label');
    expect(Array.from(labels, (el) => el.textContent)).toEqual(['index.ts', 'README.md', 'src']);
  });

  it("renders the root's children as the top level (root node has no row)", () => {
    const pane = mount(TEST_TREE);
    const rootList = pane.querySelector('ul.tree-root')!;
    const topLevelItems = rootList.querySelectorAll<HTMLLIElement>(':scope > li');
    // The three children of the root — the root folder itself is not a row.
    expect(topLevelItems.length).toBe(3);
    expect(Array.from(topLevelItems, (li) => li.dataset.path)).not.toContain('.');
  });

  // Structural assertions migrated from the deleted buildTree helper. They
  // exercise the same render path via the live <TreePane> instead of a
  // test-only bare-tree builder exported from production.
  it('sorts top-level children alphabetically (files + dirs intermingled)', () => {
    const pane = mount(TEST_TREE);
    const rootList = pane.querySelector('ul.tree-root')!;
    const labels = rootList.querySelectorAll<HTMLElement>(':scope > li > .row > .tree-label');
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

  it('with no selection, no directory is expanded', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = null;
    await flush();
    const expandedDirs = pane.querySelectorAll<HTMLLIElement>('.tree-dir.tree-expanded');
    expect(expandedDirs.length).toBe(0);
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

  it('setSelectedPath highlights the matching row and expands ancestors', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = 'src/utils.ts';
    await flush();

    const srcDir = pane.querySelector('[data-path="src"]')!;
    expect(srcDir.classList.contains('tree-expanded')).toBe(true);

    const leaf = pane.querySelector('[data-path="src/utils.ts"]')!;
    expect(leaf.classList.contains('tree-selected')).toBe(true);
  });

  it('setSelectedPath(null) clears the highlight and collapses open branches', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = 'src/utils.ts';
    await flush();
    expect(pane.querySelector('[data-path="src"]')!.classList.contains('tree-expanded')).toBe(true);

    selectedPath.value = null;
    await flush();
    expect(pane.querySelectorAll('.tree-selected').length).toBe(0);
    expect(pane.querySelector('[data-path="src"]')!.classList.contains('tree-collapsed')).toBe(
      true
    );
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

  it('clicking a directory row closes other open branches (single-branch)', async () => {
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
    pane.querySelector<HTMLElement>('[data-path="a"] > .row')!.click();
    await flush();
    expect(pane.querySelector('[data-path="a"]')!.classList.contains('tree-expanded')).toBe(true);

    pane.querySelector<HTMLElement>('[data-path="b"] > .row')!.click();
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
    expect(pane.querySelector('[data-path="src"]')!.classList.contains('tree-collapsed')).toBe(
      true
    );
  });

  // ---- Keyboard / ARIA tree semantics ----
  function keydown(el: HTMLElement, key: string) {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('exposes a labelled tree with treeitem roles and aria-expanded on dirs', () => {
    const pane = mount(TEST_TREE);
    const tree = pane.querySelector('ul.tree-root')!;
    expect(tree.getAttribute('role')).toBe('tree');
    expect(tree.getAttribute('aria-label')).toBe('File tree');

    const dir = pane.querySelector('[data-path="src"]')!;
    expect(dir.getAttribute('role')).toBe('treeitem');
    expect(dir.getAttribute('aria-expanded')).toBe('false');

    const file = pane.querySelector('[data-path="index.ts"]')!;
    expect(file.getAttribute('role')).toBe('treeitem');
    // Files are leaves: no aria-expanded.
    expect(file.hasAttribute('aria-expanded')).toBe(false);
  });

  it('roving tabindex: only the first item is a tab stop when nothing is selected', () => {
    const pane = mount(TEST_TREE);
    const items = pane.querySelectorAll<HTMLElement>('.tree-root > .tree-item');
    expect(items[0].tabIndex).toBe(0);
    expect(items[1].tabIndex).toBe(-1);
    expect(items[2].tabIndex).toBe(-1);
  });

  it('roving tabindex: the selected item becomes the tab stop', async () => {
    const pane = mount(TEST_TREE);
    selectedPath.value = 'src/utils.ts';
    await flush();
    const leaf = pane.querySelector<HTMLElement>('[data-path="src/utils.ts"]')!;
    expect(leaf.tabIndex).toBe(0);
    expect(pane.querySelector<HTMLElement>('[data-path="index.ts"]')!.tabIndex).toBe(-1);
  });

  it('Enter on a file item selects it', () => {
    let picked: TreeNode | null = null;
    const pane = mount(TEST_TREE, {
      onSelect(node) {
        picked = node;
      },
    });
    keydown(pane.querySelector<HTMLElement>('[data-path="index.ts"]')!, 'Enter');
    expect(picked).not.toBeNull();
    expect(picked!.path).toBe('index.ts');
  });

  it('ArrowDown moves past the first child inside a nested folder', async () => {
    // Regression: keydown bubbled to ancestor treeitems, whose handlers
    // re-ran and yanked focus back to the folder's first child.
    const deepTree = {
      name: 'project',
      type: 'directory',
      path: '.',
      children: [
        {
          name: 'dir',
          type: 'directory',
          path: 'dir',
          children: [
            { name: 'c1.ts', type: 'file', path: 'dir/c1.ts' },
            { name: 'c2.ts', type: 'file', path: 'dir/c2.ts' },
            { name: 'c3.ts', type: 'file', path: 'dir/c3.ts' },
          ],
        },
      ],
    };
    const pane = mount(deepTree);
    selectedPath.value = 'dir/c1.ts'; // expands the branch
    await flush();

    const c1 = pane.querySelector<HTMLElement>('[data-path="dir/c1.ts"]')!;
    const c2 = pane.querySelector<HTMLElement>('[data-path="dir/c2.ts"]')!;
    const c3 = pane.querySelector<HTMLElement>('[data-path="dir/c3.ts"]')!;
    c1.focus();
    keydown(c1, 'ArrowDown');
    expect(document.activeElement).toBe(c2);
    keydown(c2, 'ArrowDown');
    expect(document.activeElement).toBe(c3);
  });

  it('ArrowRight expands a collapsed directory; ArrowLeft collapses it', async () => {
    const pane = mount(TEST_TREE);
    const dir = () => pane.querySelector<HTMLElement>('[data-path="src"]')!;
    expect(dir().classList.contains('tree-collapsed')).toBe(true);

    keydown(dir(), 'ArrowRight');
    await flush();
    expect(dir().classList.contains('tree-expanded')).toBe(true);

    keydown(dir(), 'ArrowLeft');
    await flush();
    expect(dir().classList.contains('tree-collapsed')).toBe(true);
  });
});

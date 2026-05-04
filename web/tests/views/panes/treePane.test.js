import { describe, it, expect } from 'vitest';
import { buildTree, buildTreePane } from '../../../views/panes/treePane.js';

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

// ---- buildTree ----
describe('buildTree', () => {
  it('returns a <ul> element', () => {
    const ul = buildTree(TEST_TREE);
    expect(ul.tagName).toBe('UL');
  });

  it('has the tree-list class', () => {
    const ul = buildTree(TEST_TREE);
    expect(ul.className).toBe('tree-list');
  });

  it('creates correct number of top-level items', () => {
    const ul = buildTree(TEST_TREE);
    const items = ul.querySelectorAll(':scope > li');
    // 3 children: index.ts (file), README.md (file), src (dir)
    expect(items.length).toBe(3);
  });

  it('sorts children alphabetically with files + directories intermingled', () => {
    // Mirrors layout.js _layoutDir: a single alphabetical pass over all
    // children, no dirs-first grouping. Keeps the tree's order identical
    // to the city's road layout.
    const ul = buildTree(TEST_TREE);
    const labels = ul.querySelectorAll(':scope > li > .tree-row > .tree-label');
    const names = [];
    for (let i = 0; i < labels.length; i++) names.push(labels[i].textContent);
    expect(names).toEqual(['index.ts', 'README.md', 'src']);
  });

  it('directories start collapsed', () => {
    const ul = buildTree(TEST_TREE);
    const dirs = ul.querySelectorAll('.tree-dir');
    for (let i = 0; i < dirs.length; i++) {
      expect(dirs[i].classList.contains('tree-collapsed')).toBe(true);
    }
  });

  it('directories have nested subtrees hidden', () => {
    const ul = buildTree(TEST_TREE);
    const dir = ul.querySelector('.tree-dir');
    const subtree = dir.querySelector('.tree-list');
    expect(subtree).not.toBeNull();
    expect(subtree.style.display).toBe('none');
  });

  it('file items have tree-file class', () => {
    const ul = buildTree(TEST_TREE);
    const files = ul.querySelectorAll('.tree-file');
    // 3 total files across all nesting: index.ts, README.md, and src/utils.ts
    expect(files.length).toBe(3);
  });

  it('renders labels with file/directory names', () => {
    const ul = buildTree(TEST_TREE);
    const labels = ul.querySelectorAll('.tree-label');
    const names = [];
    for (let i = 0; i < labels.length; i++) {
      names.push(labels[i].textContent);
    }
    expect(names).toContain('src');
    expect(names).toContain('index.ts');
    expect(names).toContain('README.md');
  });

  it('stamps each item with its data path', () => {
    const ul = buildTree(TEST_TREE);
    const paths = [];
    const items = ul.querySelectorAll('li.tree-item');
    for (let i = 0; i < items.length; i++) paths.push(items[i].dataset.path);
    expect(paths).toContain('index.ts');
    expect(paths).toContain('src');
    expect(paths).toContain('src/utils.ts');
  });

  it('handles empty children array', () => {
    const ul = buildTree({ name: 'empty', type: 'directory', children: [] });
    const items = ul.querySelectorAll('li');
    expect(items.length).toBe(0);
  });

  it('clicking the chevron via buildTreePane expands and collapses the directory', () => {
    // buildTree itself doesn't wire the rootList ctx (that's a buildTreePane
    // responsibility), so the chevron's accordion-style expand needs a
    // pane-built tree. Validate the toggle behavior here instead.
    const bundle = buildTreePane(TEST_TREE);
    const dir = bundle.pane.querySelector('.tree-dir');
    const chevron = dir.querySelector(':scope > .tree-row > .tree-chevron');
    const subtree = dir.querySelector(':scope > .tree-list');

    expect(dir.classList.contains('tree-collapsed')).toBe(true);
    expect(subtree.style.display).toBe('none');

    chevron.click();

    expect(dir.classList.contains('tree-expanded')).toBe(true);
    expect(subtree.style.display).toBe('');

    chevron.click();

    expect(dir.classList.contains('tree-collapsed')).toBe(true);
    expect(subtree.style.display).toBe('none');
  });
});

// ---- buildTreePane ----
describe('buildTreePane', () => {
  it('returns { pane, api } with header + tree content', () => {
    const bundle = buildTreePane({ tree: TEST_TREE });

    expect(bundle.pane.classList.contains('left-pane')).toBe(true);
    expect(bundle.pane.classList.contains('tree-pane')).toBe(true);

    const header = bundle.pane.querySelector('.tree-header');
    expect(header).not.toBeNull();

    const title = bundle.pane.querySelector('.tree-title');
    expect(title).not.toBeNull();
    // Generic section label, not the project name (root is rendered as a
    // folder below — duplicating the name in the header would be redundant).
    expect(title.textContent).toBe('Explorer');

    const items = bundle.pane.querySelectorAll('.tree-item');
    expect(items.length).toBeGreaterThan(0);

    expect(typeof bundle.api.setSelectedPath).toBe('function');
  });

  it('accepts a bare tree (no { tree } wrapper)', () => {
    const bundle = buildTreePane(TEST_TREE);
    const title = bundle.pane.querySelector('.tree-title');
    expect(title.textContent).toBe('Explorer');
  });

  it('renders the manifest root as a top-level folder', () => {
    const bundle = buildTreePane(TEST_TREE);
    const rootList = bundle.pane.querySelector('ul.tree-root');
    const topLevelItems = rootList.querySelectorAll(':scope > li');
    // Exactly one top-level li — the root folder. Its children live nested
    // inside that li's own subtree.
    expect(topLevelItems.length).toBe(1);
    expect(topLevelItems[0].classList.contains('tree-dir')).toBe(true);
    expect(topLevelItems[0].dataset.path).toBe('.');
    expect(topLevelItems[0].querySelector(':scope > .tree-row > .tree-label').textContent).toBe(
      'project'
    );
  });

  it('with no selection, only the root folder is expanded', () => {
    const bundle = buildTreePane(TEST_TREE);
    bundle.api.setSelectedPath(null);
    const expanded = bundle.pane.querySelectorAll('.tree-dir.tree-expanded');
    expect(expanded.length).toBe(1);
    expect(expanded[0].dataset.path).toBe('.');
  });

  it('row click invokes onSelect with the node', () => {
    let picked = null;
    const bundle = buildTreePane(TEST_TREE, {
      onSelect: function (node) {
        picked = node;
      },
    });
    const fileRow = bundle.pane.querySelector('.tree-file > .tree-row');
    fileRow.click();
    expect(picked).not.toBeNull();
    expect(picked.type).toBe('file');
  });

  it('row dblclick invokes onFocus with the node', () => {
    let focused = null;
    const bundle = buildTreePane(TEST_TREE, {
      onFocus: function (node) {
        focused = node;
      },
    });
    const fileRow = bundle.pane.querySelector('.tree-file > .tree-row');
    const ev = new window.MouseEvent('dblclick', { bubbles: true, cancelable: true });
    fileRow.dispatchEvent(ev);
    expect(focused).not.toBeNull();
    expect(focused.type).toBe('file');
  });

  it('setSelectedPath highlights the matching row and expands ancestors', () => {
    const bundle = buildTreePane(TEST_TREE);
    bundle.api.setSelectedPath('src/utils.ts');

    const srcDir = bundle.pane.querySelector('[data-path="src"]');
    expect(srcDir.classList.contains('tree-expanded')).toBe(true);

    const leaf = bundle.pane.querySelector('[data-path="src/utils.ts"]');
    expect(leaf.classList.contains('tree-selected')).toBe(true);
  });

  it('setSelectedPath(null) clears the highlight and collapses non-root branches', () => {
    const bundle = buildTreePane(TEST_TREE);
    bundle.api.setSelectedPath('src/utils.ts');
    expect(bundle.pane.querySelector('[data-path="src"]').classList.contains('tree-expanded')).toBe(
      true
    );

    bundle.api.setSelectedPath(null);
    expect(bundle.pane.querySelectorAll('.tree-selected').length).toBe(0);
    // Root stays open as the project's entry point; everything else collapses.
    expect(
      bundle.pane.querySelector('[data-path="src"]').classList.contains('tree-collapsed')
    ).toBe(true);
    expect(bundle.pane.querySelector('[data-path="."]').classList.contains('tree-expanded')).toBe(
      true
    );
  });

  it('setSelectedPath enforces the single-branch-open invariant', () => {
    // Two sibling directories at the root — selecting deep into one must
    // collapse the other.
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
    const bundle = buildTreePane(multiBranch);
    bundle.api.setSelectedPath('a/a1.ts');
    expect(bundle.pane.querySelector('[data-path="a"]').classList.contains('tree-expanded')).toBe(
      true
    );
    expect(bundle.pane.querySelector('[data-path="b"]').classList.contains('tree-collapsed')).toBe(
      true
    );

    // Switching to the other branch — `a` must close, `b` must open.
    bundle.api.setSelectedPath('b/b1.ts');
    expect(bundle.pane.querySelector('[data-path="b"]').classList.contains('tree-expanded')).toBe(
      true
    );
    expect(bundle.pane.querySelector('[data-path="a"]').classList.contains('tree-collapsed')).toBe(
      true
    );
  });

  it('expanding a directory via the chevron closes other open branches', () => {
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
    const bundle = buildTreePane(multiBranch);
    const chevA = bundle.pane.querySelector('[data-path="a"] > .tree-row > .tree-chevron');
    const chevB = bundle.pane.querySelector('[data-path="b"] > .tree-row > .tree-chevron');

    chevA.click();
    expect(bundle.pane.querySelector('[data-path="a"]').classList.contains('tree-expanded')).toBe(
      true
    );

    chevB.click();
    expect(bundle.pane.querySelector('[data-path="b"]').classList.contains('tree-expanded')).toBe(
      true
    );
    expect(bundle.pane.querySelector('[data-path="a"]').classList.contains('tree-collapsed')).toBe(
      true
    );
  });

  it('row mouseenter/mouseleave invoke onHover / onHoverEnd', () => {
    let hovered = null;
    let ended = null;
    const bundle = buildTreePane(TEST_TREE, {
      onHover: function (node) {
        hovered = node;
      },
      onHoverEnd: function (node) {
        ended = node;
      },
    });
    const fileRow = bundle.pane.querySelector('.tree-file > .tree-row');
    fileRow.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
    expect(hovered).not.toBeNull();
    expect(hovered.type).toBe('file');

    fileRow.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
    expect(ended).not.toBeNull();
  });

  it('setHoveredPath toggles the tree-hovered class', () => {
    const bundle = buildTreePane(TEST_TREE);
    bundle.api.setHoveredPath('index.ts');
    expect(
      bundle.pane.querySelector('[data-path="index.ts"]').classList.contains('tree-hovered')
    ).toBe(true);

    bundle.api.setHoveredPath(null);
    expect(bundle.pane.querySelectorAll('.tree-hovered').length).toBe(0);
  });

  it('setHoveredPath does not change directory expansion', () => {
    // Hover is a transient cosmetic mirror — it must not fight the
    // single-branch-open rule that selection enforces.
    const bundle = buildTreePane(TEST_TREE);
    const srcDir = bundle.pane.querySelector('[data-path="src"]');
    expect(srcDir.classList.contains('tree-collapsed')).toBe(true);

    bundle.api.setHoveredPath('src/utils.ts');
    expect(srcDir.classList.contains('tree-collapsed')).toBe(true);
  });
});

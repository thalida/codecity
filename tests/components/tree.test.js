import { describe, it, expect } from 'vitest';
import {
  buildTree,
  buildTreePane,
} from '../../src/components/tree.js';

const TEST_TREE = {
  name: "project", type: "directory", path: ".",
  children_count: 3, children_file_count: 2, children_dir_count: 1,
  descendants_count: 4, descendants_file_count: 3, descendants_dir_count: 1,
  descendants_size: 5000,
  children: [
    { name: "index.ts", type: "file", path: "index.ts", extension: ".ts",
      size: 2000, lines: 80 },
    { name: "README.md", type: "file", path: "README.md", extension: ".md",
      size: 500, lines: 20 },
    { name: "src", type: "directory", path: "src",
      children_count: 1, children_file_count: 1, children_dir_count: 0,
      descendants_count: 1, descendants_file_count: 1, descendants_dir_count: 0,
      descendants_size: 800,
      children: [
        { name: "utils.ts", type: "file", path: "src/utils.ts", extension: ".ts",
          size: 800, lines: 30 }
      ]
    }
  ]
};

// ---- buildTree ----
describe('buildTree', () => {
  it('returns a <ul> element', () => {
    var ul = buildTree(TEST_TREE);
    expect(ul.tagName).toBe('UL');
  });

  it('has the tree-list class', () => {
    var ul = buildTree(TEST_TREE);
    expect(ul.className).toBe('tree-list');
  });

  it('creates correct number of top-level items', () => {
    var ul = buildTree(TEST_TREE);
    var items = ul.querySelectorAll(':scope > li');
    // 3 children: src (dir), index.ts (file), README.md (file)
    expect(items.length).toBe(3);
  });

  it('sorts directories before files', () => {
    var ul = buildTree(TEST_TREE);
    var items = ul.querySelectorAll(':scope > li');
    // First item should be the directory (src)
    expect(items[0].classList.contains('tree-dir')).toBe(true);
  });

  it('directories start collapsed', () => {
    var ul = buildTree(TEST_TREE);
    var dirs = ul.querySelectorAll('.tree-dir');
    for (var i = 0; i < dirs.length; i++) {
      expect(dirs[i].classList.contains('tree-collapsed')).toBe(true);
    }
  });

  it('directories have nested subtrees hidden', () => {
    var ul = buildTree(TEST_TREE);
    var dir = ul.querySelector('.tree-dir');
    var subtree = dir.querySelector('.tree-list');
    expect(subtree).not.toBeNull();
    expect(subtree.style.display).toBe('none');
  });

  it('file items have tree-file class', () => {
    var ul = buildTree(TEST_TREE);
    var files = ul.querySelectorAll('.tree-file');
    // 3 total files across all nesting: index.ts, README.md, and src/utils.ts
    expect(files.length).toBe(3);
  });

  it('renders labels with file/directory names', () => {
    var ul = buildTree(TEST_TREE);
    var labels = ul.querySelectorAll('.tree-label');
    var names = [];
    for (var i = 0; i < labels.length; i++) {
      names.push(labels[i].textContent);
    }
    expect(names).toContain('src');
    expect(names).toContain('index.ts');
    expect(names).toContain('README.md');
  });

  it('handles empty children array', () => {
    var ul = buildTree({ name: "empty", type: "directory", children: [] });
    var items = ul.querySelectorAll('li');
    expect(items.length).toBe(0);
  });

  it('clicking a directory toggle expands it', () => {
    var ul = buildTree(TEST_TREE);
    var dir = ul.querySelector('.tree-dir');
    var toggle = dir.querySelector('.tree-toggle');
    var subtree = dir.querySelector('.tree-list');

    // Initially collapsed
    expect(dir.classList.contains('tree-collapsed')).toBe(true);
    expect(subtree.style.display).toBe('none');

    // Click to expand
    toggle.click();

    expect(dir.classList.contains('tree-expanded')).toBe(true);
    expect(dir.classList.contains('tree-collapsed')).toBe(false);
    expect(subtree.style.display).toBe('');

    // Click again to collapse
    toggle.click();

    expect(dir.classList.contains('tree-collapsed')).toBe(true);
    expect(dir.classList.contains('tree-expanded')).toBe(false);
    expect(subtree.style.display).toBe('none');
  });
});

// ---- buildTreePane ----
describe('buildTreePane', () => {
  it('returns a pane element with header + tree content', () => {
    var pane = buildTreePane({ tree: TEST_TREE });

    expect(pane.classList.contains('left-pane')).toBe(true);
    expect(pane.classList.contains('tree-pane')).toBe(true);

    var header = pane.querySelector('.tree-header');
    expect(header).not.toBeNull();

    var title = pane.querySelector('.tree-title');
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('project');

    var items = pane.querySelectorAll('.tree-item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('accepts a bare tree (no { tree } wrapper)', () => {
    var pane = buildTreePane(TEST_TREE);
    var title = pane.querySelector('.tree-title');
    expect(title.textContent).toBe('project');
  });
});

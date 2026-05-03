import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showFileSidebar, showDirSidebar, closeSidebar, setSidebarCloseHandler } from '../../components/sidebar.js';

function resetDom() {
  document.body.innerHTML = '<div id="sidebar"></div>';
}

const FILE_NODE = {
  name: 'index.ts',
  type: 'file',
  path: 'src/index.ts',
  fullPath: '/tmp/project/src/index.ts',
  extension: '.ts',
  size: 1536,
  lines: 50,
  created: '2024-01-10T09:00:00Z',
  modified: '2024-03-20T10:00:00Z',
  git: {
    created: '2024-01-10T09:00:00Z',
    modified: '2024-03-20T10:00:00Z',
  },
};

const DIR_NODE = {
  name: 'src',
  type: 'directory',
  path: 'src',
  fullPath: '/tmp/project/src',
  children_count: 3,
  children_file_count: 2,
  children_dir_count: 1,
  descendants_count: 5,
  descendants_file_count: 4,
  descendants_dir_count: 1,
  descendants_size: 6000,
};

describe('showFileSidebar', () => {
  beforeEach(resetDom);

  it('adds .open class to #sidebar', () => {
    showFileSidebar(FILE_NODE);
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
  });

  it('renders the filename as the leaf breadcrumb segment', () => {
    showFileSidebar(FILE_NODE);
    const leaf = document.querySelector('.editor-header-segment.is-leaf');
    expect(leaf).not.toBeNull();
    expect(leaf.textContent).toBe('index.ts');
  });

  it('renders an extension chip in the header', () => {
    showFileSidebar(FILE_NODE);
    const chip = document.querySelector('.editor-tab-chip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('ts');  // leading dot stripped
  });

  it('shows size + line count in the status bar', () => {
    showFileSidebar(FILE_NODE);
    const text = document.querySelector('.editor-status-bar').textContent;
    expect(text).toContain('1.5 KB');
    expect(text).toContain('50 lines');
  });

  it('clears existing content on re-open', () => {
    showFileSidebar(FILE_NODE);
    showFileSidebar({ ...FILE_NODE, name: 'utils.ts', path: 'src/utils.ts' });
    const leaves = document.querySelectorAll('.editor-header-segment.is-leaf');
    expect(leaves.length).toBe(1);
    expect(leaves[0].textContent).toBe('utils.ts');
  });

  it('does nothing if #sidebar is missing', () => {
    document.body.innerHTML = '';
    expect(() => showFileSidebar(FILE_NODE)).not.toThrow();
  });
});

describe('showDirSidebar', () => {
  beforeEach(resetDom);

  it('adds .open class to #sidebar', () => {
    showDirSidebar(DIR_NODE);
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
  });

  it('renders directory name as leaf breadcrumb + dir chip', () => {
    showDirSidebar(DIR_NODE);
    expect(document.querySelector('.editor-header-segment.is-leaf').textContent).toBe('src');
    expect(document.querySelector('.editor-tab-chip-dir').textContent).toBe('dir');
  });

  it('renders children + descendants stats in the body', () => {
    showDirSidebar(DIR_NODE);
    const text = document.querySelector('.dir-info').textContent;
    expect(text).toContain('3');  // direct children total
    expect(text).toContain('2');  // direct children files
    expect(text).toContain('5');  // recursive total
    expect(text).toContain('4');  // recursive files
  });
});

describe('closeSidebar', () => {
  beforeEach(resetDom);

  it('removes .open class from #sidebar', () => {
    showFileSidebar(FILE_NODE);
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
    closeSidebar();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });

  it('does nothing if #sidebar is missing', () => {
    document.body.innerHTML = '';
    expect(() => closeSidebar()).not.toThrow();
  });
});

describe('setSidebarCloseHandler', () => {
  beforeEach(resetDom);

  it('fires the registered handler when closeSidebar is called', () => {
    var handler = vi.fn();
    setSidebarCloseHandler(handler);
    closeSidebar();
    expect(handler).toHaveBeenCalledTimes(1);
    setSidebarCloseHandler(null);   // cleanup
  });

  it('passing null clears the handler', () => {
    var handler = vi.fn();
    setSidebarCloseHandler(handler);
    setSidebarCloseHandler(null);
    closeSidebar();
    expect(handler).not.toHaveBeenCalled();
  });
});

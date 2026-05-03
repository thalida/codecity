import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showFileSidebar, showDirSidebar, closeSidebar, setSidebarCloseHandler } from '../../src/components/sidebar.js';

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

  it('renders the file name in the title', () => {
    showFileSidebar(FILE_NODE);
    const title = document.querySelector('.sidebar-title');
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('index.ts');
  });

  it('renders an extension badge', () => {
    showFileSidebar(FILE_NODE);
    const badge = document.querySelector('.ext-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('.ts');
  });

  it('renders size + line-count stats', () => {
    showFileSidebar(FILE_NODE);
    const text = document.getElementById('sidebar').textContent;
    expect(text).toContain('1.5 KB');
    expect(text).toContain('50');
  });

  it('clears existing content on re-open', () => {
    showFileSidebar(FILE_NODE);
    showFileSidebar({ ...FILE_NODE, name: 'utils.ts' });
    const titles = document.querySelectorAll('.sidebar-title');
    expect(titles.length).toBe(1);
    expect(titles[0].textContent).toBe('utils.ts');
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

  it('renders directory name + directory badge', () => {
    showDirSidebar(DIR_NODE);
    expect(document.querySelector('.sidebar-title').textContent).toBe('src');
    expect(document.querySelector('.dir-badge').textContent).toBe('directory');
  });

  it('renders children + descendants stats', () => {
    showDirSidebar(DIR_NODE);
    const text = document.getElementById('sidebar').textContent;
    // children counts
    expect(text).toContain('3');  // total children
    expect(text).toContain('2');  // children files
    // descendants counts
    expect(text).toContain('5');  // total descendants
    expect(text).toContain('4');  // descendant files
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

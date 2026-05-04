import { describe, it, expect, beforeEach } from 'vitest';
import { showFileSidebar, showDirSidebar, hideSidebar, showEmptySidebar } from '../../components/sidebar.js';

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

  it('renders no header chrome — preview pane only', () => {
    showFileSidebar(FILE_NODE);
    // Header / chip / close-button live in the sitewide app header now,
    // not inside the right sidebar.
    expect(document.querySelector('.editor-header')).toBeNull();
    expect(document.querySelector('.app-header-chip')).toBeNull();
    expect(document.querySelector('.editor-header-icon')).toBeNull();
  });

  it('renders the editor body (preview)', () => {
    showFileSidebar(FILE_NODE);
    expect(document.querySelector('.editor-body')).not.toBeNull();
  });

  it('clears existing content on re-open', () => {
    showFileSidebar(FILE_NODE);
    showFileSidebar({ ...FILE_NODE, name: 'utils.ts', path: 'src/utils.ts' });
    const bodies = document.querySelectorAll('.editor-body');
    expect(bodies.length).toBe(1);
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

  it('shows the empty-state hint (directories are not previewable)', () => {
    showDirSidebar(DIR_NODE);
    expect(document.querySelector('.editor-header')).toBeNull();
    expect(document.querySelector('.preview-state')).not.toBeNull();
  });
});

describe('showEmptySidebar', () => {
  beforeEach(resetDom);

  it('opens the panel with the empty-state hint', () => {
    showEmptySidebar();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
    expect(document.querySelector('.preview-state')).not.toBeNull();
  });
});

describe('hideSidebar', () => {
  beforeEach(resetDom);

  it('removes .open class from #sidebar', () => {
    showFileSidebar(FILE_NODE);
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
    hideSidebar();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });

  it('does nothing if #sidebar is missing', () => {
    document.body.innerHTML = '';
    expect(() => hideSidebar()).not.toThrow();
  });
});

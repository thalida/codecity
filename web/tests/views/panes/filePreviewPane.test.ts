import { describe, it, expect, beforeEach } from 'vitest';
import { buildFilePreviewPane } from '../../../views/panes/filePreviewPane.js';
import { showRightSidebar, hideRightSidebar } from '../../../views/shell/rightSidebar.js';
import type { FileNode } from '../../../types';

function resetDom() {
  document.body.innerHTML = '<div id="sidebar"></div>';
}

const FILE_NODE: FileNode = {
  name: 'index.ts',
  type: 'file',
  path: 'src/index.ts',
  fullPath: '/tmp/project/src/index.ts',
  extension: '.ts',
  size: 1536,
  lines: 50,
  binary: false,
  created: '2024-01-10T09:00:00Z',
  modified: '2024-03-20T10:00:00Z',
  git: {
    created: '2024-01-10T09:00:00Z',
    modified: '2024-03-20T10:00:00Z',
  },
};

describe('buildFilePreviewPane', () => {
  beforeEach(resetDom);

  it('returns a .editor-body pane element', () => {
    const { pane } = buildFilePreviewPane();
    expect(pane.classList.contains('editor-body')).toBe(true);
  });

  it('starts in the empty state (no file)', () => {
    const { pane } = buildFilePreviewPane();
    expect(pane.querySelector('.preview-state')).not.toBeNull();
  });

  it('setFile(file) replaces the empty state with preview content', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile(FILE_NODE);
    // .preview-state can re-appear inside the shell after a fetch
    // failure, but the body should no longer be ONLY a state message —
    // a .preview-shell wrapper is the file path's first child.
    expect(pane.querySelector('.preview-shell')).not.toBeNull();
  });

  it('setFile(null) returns to the empty state', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile(FILE_NODE);
    api.setFile(null);
    expect(pane.querySelector('.preview-state')).not.toBeNull();
    expect(pane.querySelector('.preview-shell')).toBeNull();
  });

  it('successive setFile calls leave a single body content tree', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile(FILE_NODE);
    api.setFile({ ...FILE_NODE, name: 'utils.ts', path: 'src/utils.ts' });
    // exactly one preview-shell, no leftover from the first call
    expect(pane.querySelectorAll('.preview-shell').length).toBe(1);
  });
});

describe('showRightSidebar / hideRightSidebar', () => {
  beforeEach(resetDom);

  it('mounts a pane and adds .open to #sidebar', () => {
    const { pane } = buildFilePreviewPane();
    showRightSidebar(pane);
    expect(document.getElementById('sidebar')!.classList.contains('open')).toBe(true);
    expect(document.querySelector('#sidebar .editor-body')).toBe(pane);
  });

  it('does not duplicate the pane when called twice with the same pane', () => {
    const { pane } = buildFilePreviewPane();
    showRightSidebar(pane);
    showRightSidebar(pane);
    expect(document.querySelectorAll('#sidebar .editor-body').length).toBe(1);
  });

  it('swaps the pane when called with a different pane', () => {
    const a = buildFilePreviewPane().pane;
    const b = buildFilePreviewPane().pane;
    showRightSidebar(a);
    showRightSidebar(b);
    const bodies = document.querySelectorAll('#sidebar .editor-body');
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toBe(b);
  });

  it('hideRightSidebar removes .open but keeps the mounted pane', () => {
    const { pane } = buildFilePreviewPane();
    showRightSidebar(pane);
    hideRightSidebar();
    expect(document.getElementById('sidebar')!.classList.contains('open')).toBe(false);
    expect(document.querySelector('#sidebar .editor-body')).toBe(pane);
  });

  it('does nothing if #sidebar is missing', () => {
    document.body.innerHTML = '';
    const { pane } = buildFilePreviewPane();
    expect(() => showRightSidebar(pane)).not.toThrow();
    expect(() => hideRightSidebar()).not.toThrow();
  });
});

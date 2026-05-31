import { describe, it, expect, beforeEach } from 'vitest';
import { buildFilePreviewPane } from '@/views/panes/FilePreviewPane';
import { showRightSidebar, hideRightSidebar } from '@/views/shell/RightSidebar';
import { NodeKind } from '@/types';
import type { FileNode } from '@/types';

function resetDom() {
  document.body.innerHTML = '<div id="right-sidebar"></div>';
}

const FILE_NODE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
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

  it('returns a .pane wrapper containing a .editor-body', () => {
    const { pane } = buildFilePreviewPane();
    expect(pane.classList.contains('pane')).toBe(true);
    expect(pane.querySelector('.editor-body')).not.toBeNull();
  });

  it('renders a pane header with a title element', () => {
    const { pane } = buildFilePreviewPane();
    expect(pane.querySelector('.pane-header')).not.toBeNull();
    expect(pane.querySelector('.text-pane-title')).not.toBeNull();
  });

  it('starts in the empty state (no file) with "No file" title', () => {
    const { pane } = buildFilePreviewPane();
    expect(pane.querySelector('.empty-state')).not.toBeNull();
    expect(pane.querySelector('.text-pane-title')!.textContent).toBe('No file');
  });

  it('setFile(file) replaces the empty state with preview content and shows the filename', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile(FILE_NODE);
    // .empty-state can re-appear inside the shell after a fetch
    // failure, but the body should no longer be ONLY a state message —
    // a .preview-shell wrapper is the file path's first child.
    expect(pane.querySelector('.preview-shell')).not.toBeNull();
    // The title shows just the leaf filename (compact sidebar header — the
    // full path lives in the sitewide app header).
    expect(pane.querySelector('.text-pane-title')!.textContent).toBe('index.ts');
  });

  it('setFile(null) returns to the empty state and the "No file" title', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile(FILE_NODE);
    api.setFile(null);
    expect(pane.querySelector('.empty-state')).not.toBeNull();
    expect(pane.querySelector('.preview-shell')).toBeNull();
    expect(pane.querySelector('.text-pane-title')!.textContent).toBe('No file');
  });

  it('successive setFile calls leave a single body content tree', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile(FILE_NODE);
    api.setFile({ ...FILE_NODE, name: 'utils.ts', path: 'src/utils.ts' });
    // exactly one preview-shell, no leftover from the first call
    expect(pane.querySelectorAll('.preview-shell').length).toBe(1);
    expect(pane.querySelector('.text-pane-title')!.textContent).toBe('utils.ts');
  });

  it('falls through to preview (no "too large" state) for a 10 MB file', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile({ ...FILE_NODE, size: 10 * 1024 * 1024 });
    // 10 MB is below the 100 MB cap → no client-side "too large" gate;
    // the preview-shell scaffold gets mounted while the fetch flies
    // (the rendering tier is selected after the response arrives).
    expect(pane.querySelector('.preview-shell')).not.toBeNull();
    const stateTitle = pane.querySelector('.text-card-title');
    if (stateTitle) expect(stateTitle.textContent).not.toContain('too large');
  });

  it('shows the "too large" state for files above the 100 MB API cap', () => {
    const { pane, api } = buildFilePreviewPane();
    api.setFile({ ...FILE_NODE, size: 200 * 1024 * 1024 });
    expect(pane.querySelector('.preview-shell')).toBeNull();
    expect(pane.querySelector('.empty-state')).not.toBeNull();
    expect(pane.querySelector('.text-card-title')!.textContent).toContain('too large');
  });

  it('renders the × close button only when onClose is provided', () => {
    const noClose = buildFilePreviewPane();
    expect(noClose.pane.querySelector('.pane-header .btn-icon--text:last-child')).toBeNull();

    let closed = false;
    const withClose = buildFilePreviewPane({
      onClose: () => {
        closed = true;
      },
    });
    const btn = withClose.pane.querySelector(
      '.pane-header .btn-icon--text:last-child'
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(closed).toBe(true);
  });
});

describe('showRightSidebar / hideRightSidebar', () => {
  beforeEach(resetDom);

  it('mounts a pane and adds .open to #right-sidebar', () => {
    const { pane } = buildFilePreviewPane();
    showRightSidebar(pane);
    expect(document.getElementById('right-sidebar')!.classList.contains('open')).toBe(true);
    expect(document.querySelector('#right-sidebar > .pane')).toBe(pane);
  });

  it('does not duplicate the pane when called twice with the same pane', () => {
    const { pane } = buildFilePreviewPane();
    showRightSidebar(pane);
    showRightSidebar(pane);
    expect(document.querySelectorAll('#right-sidebar > .pane').length).toBe(1);
  });

  it('swaps the pane when called with a different pane', () => {
    const a = buildFilePreviewPane().pane;
    const b = buildFilePreviewPane().pane;
    showRightSidebar(a);
    showRightSidebar(b);
    const panes = document.querySelectorAll('#right-sidebar > .pane');
    expect(panes.length).toBe(1);
    expect(panes[0]).toBe(b);
  });

  it('hideRightSidebar removes .open but keeps the mounted pane', () => {
    const { pane } = buildFilePreviewPane();
    showRightSidebar(pane);
    hideRightSidebar();
    expect(document.getElementById('right-sidebar')!.classList.contains('open')).toBe(false);
    expect(document.querySelector('#right-sidebar > .pane')).toBe(pane);
  });

  it('does nothing if #right-sidebar is missing', () => {
    document.body.innerHTML = '';
    const { pane } = buildFilePreviewPane();
    expect(() => showRightSidebar(pane)).not.toThrow();
    expect(() => hideRightSidebar()).not.toThrow();
  });
});

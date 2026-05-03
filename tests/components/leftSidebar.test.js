import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showLeftSidebar } from '../../src/components/leftSidebar.js';

const TEST_TREE = {
  name: 'project', type: 'directory',
  children: [
    { name: 'a.ts', type: 'file', extension: '.ts', size: 100, lines: 10 }
  ]
};

describe('showLeftSidebar', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'tree-sidebar';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('mounts an activity bar with both tab icons', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const icons = container.querySelectorAll('.activity-bar .activity-bar-icon');
    expect(icons.length).toBe(2);
    expect(icons[0].dataset.tab).toBe('tree');
    expect(icons[1].dataset.tab).toBe('controls');
  });

  it('shows the tree pane by default and hides the controls pane', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const treePane     = container.querySelector('.tree-pane');
    const controlsPane = container.querySelector('.controls-pane');
    expect(treePane.style.display).toBe('');
    expect(controlsPane.style.display).toBe('none');
    expect(container.querySelector('.activity-bar-icon[data-tab="tree"]').classList.contains('active')).toBe(true);
  });

  it('switches panes when an icon is clicked', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const controlsBtn = container.querySelector('.activity-bar-icon[data-tab="controls"]');
    controlsBtn.click();

    expect(container.querySelector('.tree-pane').style.display).toBe('none');
    expect(container.querySelector('.controls-pane').style.display).toBe('');
    expect(controlsBtn.classList.contains('active')).toBe(true);
  });

  it('forwards reset-view clicks from the controls pane', () => {
    const handler = vi.fn();
    showLeftSidebar({ tree: TEST_TREE }, { onResetView: handler });
    container.querySelector('.activity-bar-icon[data-tab="controls"]').click();
    container.querySelector('.controls-button').click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('respects initialTab=controls', () => {
    showLeftSidebar({ tree: TEST_TREE }, { initialTab: 'controls' });
    expect(container.querySelector('.tree-pane').style.display).toBe('none');
    expect(container.querySelector('.controls-pane').style.display).toBe('');
  });

  it('does nothing if #tree-sidebar is missing', () => {
    document.body.removeChild(container);
    expect(() => showLeftSidebar({ tree: TEST_TREE })).not.toThrow();
    // Re-add so afterEach can remove it
    document.body.appendChild(container);
  });
});

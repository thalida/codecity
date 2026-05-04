import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showLeftSidebar } from '../../components/leftSidebar.js';

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

  it('mounts an activity bar with one icon per tab', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const icons = container.querySelectorAll('.activity-bar .activity-bar-icon');
    expect(icons.length).toBe(3);
    expect(icons[0].dataset.tab).toBe('tree');
    expect(icons[1].dataset.tab).toBe('info');
    expect(icons[2].dataset.tab).toBe('controls');
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

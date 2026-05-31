import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showLeftSidebar } from '@/views/shell/leftSidebar';
import { SidebarTab } from '@/types';

// TEST_TREE is structurally compatible with the
// `{ tree: unknown; [k: string]: unknown }` branch that showLeftSidebar
// accepts (extra fields like `binary` / `git` aren't read by the panes
// the sidebar mounts in this test).
const TEST_TREE = {
  name: 'project',
  type: 'directory',
  children: [{ name: 'a.ts', type: 'file', extension: '.ts', size: 100, lines: 10 }],
};

describe('showLeftSidebar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'left-sidebar';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('mounts an activity bar with one icon per tab', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const icons = container.querySelectorAll<HTMLButtonElement>('.activity-bar .activity-bar-icon');
    expect(icons.length).toBe(4);
    expect(icons[0].dataset.tab).toBe('tree');
    expect(icons[1].dataset.tab).toBe('search');
    expect(icons[2].dataset.tab).toBe('info');
    expect(icons[3].dataset.tab).toBe('controls');
  });

  it('places Controls in the bottom activity-bar group, others in the top', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const top = container.querySelectorAll<HTMLButtonElement>(
      '.activity-bar-top .activity-bar-icon'
    );
    const bottom = container.querySelectorAll<HTMLButtonElement>(
      '.activity-bar-bottom .activity-bar-icon'
    );
    expect(Array.from(top).map((b) => b.dataset.tab)).toEqual(['tree', 'search', 'info']);
    expect(Array.from(bottom).map((b) => b.dataset.tab)).toEqual(['controls']);
  });

  it('shows the tree pane by default and hides the controls pane', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const treePane = container.querySelector<HTMLElement>('.tree-pane')!;
    const controlsPane = container.querySelector<HTMLElement>('.controls-pane')!;
    expect(treePane.style.display).toBe('');
    expect(controlsPane.style.display).toBe('none');
    expect(
      container.querySelector('.activity-bar-icon[data-tab="tree"]')!.classList.contains('active')
    ).toBe(true);
  });

  it('switches panes when an icon is clicked', () => {
    showLeftSidebar({ tree: TEST_TREE }, {});
    const controlsBtn = container.querySelector<HTMLButtonElement>(
      '.activity-bar-icon[data-tab="controls"]'
    )!;
    controlsBtn.click();

    expect(container.querySelector<HTMLElement>('.tree-pane')!.style.display).toBe('none');
    expect(container.querySelector<HTMLElement>('.controls-pane')!.style.display).toBe('');
    expect(controlsBtn.classList.contains('active')).toBe(true);
  });

  it('respects initialTab=controls', () => {
    showLeftSidebar({ tree: TEST_TREE }, { initialTab: SidebarTab.Controls });
    expect(container.querySelector<HTMLElement>('.tree-pane')!.style.display).toBe('none');
    expect(container.querySelector<HTMLElement>('.controls-pane')!.style.display).toBe('');
  });

  it('does nothing if #left-sidebar is missing', () => {
    document.body.removeChild(container);
    expect(() => showLeftSidebar({ tree: TEST_TREE })).not.toThrow();
    // Re-add so afterEach can remove it
    document.body.appendChild(container);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ExplorePane } from '@/views/CityView/panes/ExplorePane/ExplorePane';
import { flush } from '../../../../_helpers/preact';
import { makeSession, renderInProject } from '../../../../_helpers/project';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

const TREE = {
  name: 'project',
  type: 'directory',
  path: '.',
  children: [
    { name: 'index.ts', type: 'file', path: 'index.ts' },
    { name: 'README.md', type: 'file', path: 'README.md' },
  ],
};

describe('ExplorePane', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const tabByLabel = (label: string) =>
    Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent === label
    ) as HTMLButtonElement;

  function mount() {
    const manifest = signal<unknown>({ tree: TREE });
    const selectedPath = signal<string | null>(null);
    const hoveredPath = signal<string | null>(null);
    const expanded = signal<Set<string>>(new Set(['.']));
    act(() => {
      renderInProject(
        <ExplorePane
          manifest={manifest as never}
          selectedPath={selectedPath}
          hoveredPath={hoveredPath}
          expanded={expanded}
          rootPath="."
        />,
        session,
        container
      );
    });
  }

  it('defaults to the File tree subtab', () => {
    mount();
    expect(tabByLabel('File tree').getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Readme').getAttribute('aria-selected')).toBe('false');
    expect(container.querySelector('ul.tree-root')).not.toBeNull();
  });

  it('switches to the Readme subtab when clicked (tree body unmounts)', async () => {
    mount();
    tabByLabel('Readme').click();
    await flush();
    expect(tabByLabel('Readme').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('ul.tree-root')).toBeNull();
  });
});

// The chip is the only thing on screen that says something is selected once its
// pane is closed, and the only pointer-reachable way to clear one.

import { FileNode, NodeKind, PickTarget } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { SelectionChip } from '@/features/city/components/CityStage/SelectionChip/SelectionChip';
import { createCityChrome, type CityChromeState } from '@/features/city/state/sidebar';
import { renderWithCity, type FakeCity } from '../_helpers/cityChrome';
import { drainAsync } from '../_helpers/preact';

const FILE: FileNode = {
  name: 'index.ts',
  type: NodeKind.File,
  path: 'src/index.ts',
  extension: '.ts',
  size: 10,
  lines: 2,
  binary: false,
  dirty: false,
  created: '2024-01-01T00:00:00Z',
  modified: '2024-01-02T00:00:00Z',
};

describe('SelectionChip', () => {
  let container: HTMLDivElement;
  let city: FakeCity;
  let chrome: CityChromeState;
  const chip = () => container.querySelector('.selection-chip');

  const pick = async (target: PickTarget) => {
    city.picker.setSelection(target);
    await drainAsync();
  };
  const select = () =>
    pick({
      kind: NodeKind.File,
      file: FILE,
      mesh: {} as never,
      data: {} as never,
    } as unknown as PickTarget);
  const dismiss = async () => {
    chrome.dismissDetails();
    await drainAsync();
  };

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    chrome = createCityChrome();
    city = renderWithCity(<SelectionChip />, container, undefined, chrome);
    await drainAsync();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('stays out of the way with nothing selected', () => {
    expect(chip()).toBeNull();
  });

  it('stays out of the way while the pane is showing the same node', async () => {
    await select();
    expect(chip()).toBeNull();
  });

  it('appears once that selection’s pane is dismissed', async () => {
    await select();
    await dismiss();
    expect(chip()).not.toBeNull();
    expect(chip()!.textContent).toContain('index.ts');
  });

  // The chip stands in for a closed pane, so it carries the same file/dir badge
  // that pane's header would have.
  it('carries the extension badge for a file', async () => {
    await select();
    await dismiss();

    const badge = chip()!.querySelector('.path-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('ts');
    expect(badge!.classList.contains('is-dir')).toBe(false);
  });

  it('carries the dir badge for a directory', async () => {
    await pick({
      kind: NodeKind.Directory,
      dir: { name: 'styles', type: NodeKind.Directory, path: 'src/styles' } as never,
      sidewalk: {} as never,
      street: {} as never,
    } as unknown as PickTarget);
    await dismiss();

    const badge = chip()!.querySelector('.path-badge');
    expect(badge!.textContent).toBe('dir');
    expect(badge!.classList.contains('is-dir')).toBe(true);
    expect(chip()!.textContent).toContain('styles');
  });

  it('names the kind for a commit, whose label is only a hash', async () => {
    await pick({
      kind: NodeKind.Commit,
      commit: { sha: 'abc1234def5678' } as never,
      mesh: {} as never,
      instanceId: 0,
    } as unknown as PickTarget);
    await dismiss();

    expect(chip()!.querySelector('.path-badge')!.textContent).toBe('commit');
    expect(chip()!.textContent).toContain('abc1234');
  });

  it('clears the selection from its ✕', async () => {
    await select();
    await dismiss();

    act(() => container.querySelector<HTMLButtonElement>('.selection-chip-clear')!.click());
    await drainAsync();

    expect(city.picker.selection).toBeNull();
    expect(chip()).toBeNull();
  });

  it('reopens the pane from its label, and stands down when it does', async () => {
    await select();
    await dismiss();

    act(() => container.querySelector<HTMLButtonElement>('.selection-chip-label')!.click());
    await drainAsync();

    expect(chrome.detailsDismissed.value).toBe(false);
    expect(chip()).toBeNull();
  });
});

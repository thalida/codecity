import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { SelectionAnnouncer } from '@/views/CityView/SelectionAnnouncer/SelectionAnnouncer';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/city/scene/types/picker';
import { flush } from '../_helpers/preact';
import { makeSession, renderInCity } from '../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

describe('SelectionAnnouncer', () => {
  let container: HTMLDivElement;
  const selection = signal<PickTarget | null>(null);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    selection.value = null;
    // Minimal fake handle exposing just the picker.selection signal.
    session.scene.value = { picker: { selection } } as unknown as typeof session.scene.value;
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    session.scene.value = null;
  });

  const region = () => container.querySelector('[role="status"]') as HTMLElement;

  it('is a polite, atomic, visually-hidden live region', async () => {
    renderInCity(<SelectionAnnouncer />, session, container);
    await flush();
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().getAttribute('aria-atomic')).toBe('true');
    expect(region().classList.contains('sr-only')).toBe(true);
    expect(region().textContent).toBe('');
  });

  it('announces a selected file by path', async () => {
    renderInCity(<SelectionAnnouncer />, session, container);
    await flush();
    selection.value = { kind: NodeKind.File, file: { path: 'src/a.ts' } } as unknown as PickTarget;
    await flush();
    expect(region().textContent).toBe('Selected file: src/a.ts');
  });

  it('announces a selected directory and clears on deselect', async () => {
    renderInCity(<SelectionAnnouncer />, session, container);
    await flush();
    selection.value = { kind: NodeKind.Directory, dir: { path: 'src' } } as unknown as PickTarget;
    await flush();
    expect(region().textContent).toBe('Selected directory: src');
    selection.value = null;
    await flush();
    expect(region().textContent).toBe('');
  });
});

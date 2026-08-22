import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { SelectionAnnouncer } from '@/views/CityView/SelectionAnnouncer/SelectionAnnouncer';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types';
import { flush } from '../_helpers/preact';
import { makeSession, renderInProject } from '../_helpers/project';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

describe('SelectionAnnouncer', () => {
  let container: HTMLDivElement;
  const selection = signal<PickTarget | null>(null);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    selection.value = null;
    // Minimal fake handle exposing just the picker.selection signal.
    session.city.value = { picker: { selection } } as unknown as typeof session.city.value;
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    session.city.value = null;
  });

  const region = () => container.querySelector('[role="status"]') as HTMLElement;

  it('is a polite, atomic, visually-hidden live region', async () => {
    renderInProject(<SelectionAnnouncer />, session, container);
    await flush();
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().getAttribute('aria-atomic')).toBe('true');
    expect(region().classList.contains('sr-only')).toBe(true);
    expect(region().textContent).toBe('');
  });

  it('announces a selected file by path', async () => {
    renderInProject(<SelectionAnnouncer />, session, container);
    await flush();
    selection.value = { kind: NodeKind.File, file: { path: 'src/a.ts' } } as unknown as PickTarget;
    await flush();
    expect(region().textContent).toBe('Selected file: src/a.ts');
  });

  it('announces a selected directory and clears on deselect', async () => {
    renderInProject(<SelectionAnnouncer />, session, container);
    await flush();
    selection.value = { kind: NodeKind.Directory, dir: { path: 'src' } } as unknown as PickTarget;
    await flush();
    expect(region().textContent).toBe('Selected directory: src');
    selection.value = null;
    await flush();
    expect(region().textContent).toBe('');
  });
});

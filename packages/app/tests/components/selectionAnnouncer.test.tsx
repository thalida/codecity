// The canvas cannot be read by a screen reader, so what is selected in it is
// spoken here. Off the city's own picker: two cities would announce their own.

import { NodeKind, type PickTarget } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

import { SelectionAnnouncer } from '@/features/city/SelectionAnnouncer/SelectionAnnouncer';
import { renderWithCity, type FakeCity } from '../_helpers/cityChrome';
import { drainAsync } from '../_helpers/preact';

describe('SelectionAnnouncer', () => {
  let container: HTMLDivElement;
  let city: FakeCity;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    city = renderWithCity(<SelectionAnnouncer />, container);
    await drainAsync();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const region = () => container.querySelector('[role="status"]') as HTMLElement;

  /** Pick something in the city, and let the announcement settle. */
  async function pick(target: PickTarget | null): Promise<void> {
    city.picker.setSelection(target);
    await drainAsync();
  }

  it('is a polite, atomic, visually-hidden live region', () => {
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().getAttribute('aria-atomic')).toBe('true');
    expect(region().classList.contains('sr-only')).toBe(true);
    expect(region().textContent).toBe('');
  });

  it('announces a selected file by path', async () => {
    await pick({ kind: NodeKind.File, file: { path: 'src/a.ts' } } as unknown as PickTarget);
    expect(region().textContent).toBe('Selected file: src/a.ts');
  });

  it('announces a selected directory and clears on deselect', async () => {
    await pick({ kind: NodeKind.Directory, dir: { path: 'src' } } as unknown as PickTarget);
    expect(region().textContent).toBe('Selected directory: src');

    await pick(null);
    expect(region().textContent).toBe('');
  });
});

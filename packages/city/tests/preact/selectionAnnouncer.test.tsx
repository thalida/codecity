// A canvas is a graphic: a screen reader cannot read what is picked in it. Any
// host embedding one has that problem, so the package solves it once.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

import { NodeKind } from '../../src/types/manifest';
import type { PickTarget } from '../../src/types/picker';
import { SelectionAnnouncer } from '../../src/preact/SelectionAnnouncer';
import { CityProvider } from '../../src/preact/context';
import { fakeCity } from '../_helpers/cityFixtures';

describe('SelectionAnnouncer', () => {
  let host: HTMLDivElement;
  let city: ReturnType<typeof fakeCity>;

  // Preact flushes effects on a frame, which jsdom runs on a ~16ms timer: a
  // single 0ms yield reads the region before the re-render.
  const settle = async () => {
    for (let i = 0; i < 25; i++) {
      await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  };
  const region = () => host.querySelector('[role="status"]') as HTMLElement;

  const mount = () =>
    render(
      <CityProvider city={city as never}>
        <SelectionAnnouncer />
      </CityProvider>,
      host
    );

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    city = fakeCity();
    mount();
    await settle();
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  async function pick(target: PickTarget | null): Promise<void> {
    city.picker.setSelection(target);
    await settle();
  }

  it('is a polite, atomic, visually-hidden live region', () => {
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().getAttribute('aria-atomic')).toBe('true');
    expect(region().classList.contains('sr-only')).toBe(true);
    expect(region().textContent).toBe('');
  });

  it('names a picked file by its path, which is what tells two apart', async () => {
    await pick({ kind: NodeKind.File, file: { path: 'src/a.ts' } } as unknown as PickTarget);
    expect(region().textContent).toBe('Selected file: src/a.ts');
  });

  it('names a picked directory, and falls silent when nothing is picked', async () => {
    await pick({ kind: NodeKind.Directory, dir: { path: 'src' } } as unknown as PickTarget);
    expect(region().textContent).toBe('Selected directory: src');

    await pick(null);
    expect(region().textContent).toBe('');
  });

  it('reads a commit by its short sha and subject, since a sha alone says nothing', async () => {
    await pick({
      kind: NodeKind.Commit,
      commit: { sha: 'abc1234def', subject: 'Fix the thing' },
    } as unknown as PickTarget);
    expect(region().textContent).toBe('Selected commit abc1234, Fix the thing');
  });

  it('says nothing at all before there is a city to pick in', async () => {
    render(
      <CityProvider city={null}>
        <SelectionAnnouncer />
      </CityProvider>,
      host
    );
    await settle();
    expect(region().textContent).toBe('');
  });
});

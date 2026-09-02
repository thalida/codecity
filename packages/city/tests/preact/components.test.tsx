// Batteries included, nothing locked in: what a bare <City> draws, what a host
// can put in its place, and what `null` means. The pieces are addressed through
// `components`, so a host replaces one without rebuilding the rest.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

import { CityProvider } from '../../src/preact/context';
import { DefaultCityTooltip, HoverTooltip } from '../../src/preact/CityTooltip';
import { NodeKind } from '../../src/types/manifest';
import type { PickTarget } from '../../src/types/picker';
import { fakeCity } from '../_helpers/cityFixtures';

const FILE = {
  kind: NodeKind.File,
  file: { name: 'a.ts', path: 'src/a.ts' },
} as unknown as PickTarget;

const COMMIT = {
  kind: NodeKind.Commit,
  commit: { sha: 'abc1234def', subject: 'Fix the thing' },
} as unknown as PickTarget;

const settle = async () => {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
};

describe('the hover card a host gets by default', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    render(null, host);
    host.remove();
  });

  /** Mount a card the way <City>'s overlay does, with the pointer somewhere. */
  async function draw(target: PickTarget | null, Tooltip = DefaultCityTooltip) {
    const city = fakeCity();
    render(
      <CityProvider city={city as never}>
        <HoverTooltip Tooltip={Tooltip} />
      </CityProvider>,
      host
    );
    await settle();
    // Moving the pointer is what causes a hover, so it knows where it is by
    // the time it has something to say.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 }));
    city.picker.setHover(target);
    await settle();
    return city;
  }

  it('names the file under the cursor, and where it lives', async () => {
    await draw(FILE);
    const card = host.querySelector('.codecity-tooltip')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('a.ts');
    expect(card.textContent).toContain('src/a.ts');
  });

  it('reads a commit by its short sha and subject, since a sha says nothing', async () => {
    await draw(COMMIT);
    expect(host.querySelector('.codecity-tooltip')!.textContent).toContain('abc1234');
    expect(host.querySelector('.codecity-tooltip')!.textContent).toContain('Fix the thing');
  });

  it('draws nothing when the cursor is over nothing', async () => {
    await draw(null);
    expect(host.querySelector('.codecity-tooltip')).toBeNull();
  });

  it('follows the cursor rather than making the city report a position', async () => {
    await draw(FILE);
    const before = host.querySelector<HTMLElement>('.codecity-tooltip')!.style.transform;

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 300 }));
    await settle();

    expect(host.querySelector<HTMLElement>('.codecity-tooltip')!.style.transform).not.toBe(before);
  });

  it('draws the host’s card instead when it passes one', async () => {
    const Mine = ({ target }: { target: PickTarget | null }) =>
      target ? <div class="mine">mine</div> : null;

    await draw(FILE, Mine as typeof DefaultCityTooltip);

    expect(host.querySelector('.mine')).not.toBeNull();
    expect(host.querySelector('.codecity-tooltip'), 'not both').toBeNull();
  });

  it('is exported, so a host can wrap it rather than rebuild it', async () => {
    const Wrapped = ({ target }: { target: PickTarget | null }) => (
      <div class="wrapper">
        <DefaultCityTooltip target={target} />
      </div>
    );

    await draw(FILE, Wrapped as typeof DefaultCityTooltip);

    expect(host.querySelector('.wrapper .codecity-tooltip')).not.toBeNull();
  });
});

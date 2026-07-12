import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { InfoPane } from '@/views/InfoPane/InfoPane';
import { flush } from '../../_helpers/preact';

describe('InfoPane shell', () => {
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

  it('defaults to the Overview subtab', async () => {
    const sig = signal(null);
    render(<InfoPane manifest={sig as never} />, container);
    await flush();
    expect(tabByLabel('Overview').getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Legend').getAttribute('aria-selected')).toBe('false');
  });

  it('switches to Legend when its tab is clicked', async () => {
    const sig = signal(null);
    render(<InfoPane manifest={sig as never} />, container);
    await flush();
    tabByLabel('Legend').click();
    await flush();
    expect(tabByLabel('Legend').getAttribute('aria-selected')).toBe('true');
  });
});

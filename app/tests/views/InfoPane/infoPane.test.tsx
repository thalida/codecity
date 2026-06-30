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
    expect(tabByLabel('Readme').getAttribute('aria-selected')).toBe('false');
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.id).toBe('info-pane-overview-panel');
    expect(panel.getAttribute('aria-labelledby')).toBe('info-pane-overview-tab');
  });

  it('switches to Readme when its tab is clicked', async () => {
    const sig = signal(null);
    render(<InfoPane manifest={sig as never} />, container);
    await flush();
    tabByLabel('Readme').click();
    await flush();
    expect(tabByLabel('Readme').getAttribute('aria-selected')).toBe('true');
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.id).toBe('info-pane-readme-panel');
    expect(panel.getAttribute('aria-labelledby')).toBe('info-pane-readme-tab');
  });
});

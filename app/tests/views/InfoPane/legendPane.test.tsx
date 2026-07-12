import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { LegendPane } from '@/views/InfoPane/LegendPane';
import { InfoPane } from '@/views/InfoPane/InfoPane';
import { LAYER_LEGEND } from '@/views/InfoPane/almanac';
import { flush } from '../../_helpers/preact';

describe('LegendPane', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders every layer rule from the single source, keyed by section accent', () => {
    render(<LegendPane />, container);
    for (const layer of LAYER_LEGEND) {
      const row = container.querySelector(`.legend-row[data-section="${layer.key}"]`);
      expect(row, `row for ${layer.key}`).toBeTruthy();
      expect(row!.textContent).toContain(layer.title);
      expect(row!.textContent).toContain(layer.rule);
    }
  });

  it('covers the non-layer cues (root gem + hover fade)', () => {
    render(<LegendPane />, container);
    const text = container.textContent ?? '';
    expect(text).toContain('Root gem');
    expect(text).toContain('Hover fade');
  });

  it('keeps all visible copy free of em-dashes (house style: colons/commas)', () => {
    render(<LegendPane />, container);
    expect(container.querySelector('.legend')!.textContent).not.toContain('—');
  });

  it('is reachable as the Legend subtab', async () => {
    const sig = signal(null);
    render(<InfoPane manifest={sig as never} />, container);
    await flush();
    const legendTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent === 'Legend'
    ) as HTMLButtonElement;
    expect(legendTab).toBeTruthy();
    legendTab.click();
    await flush();
    expect(legendTab.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.legend')).toBeTruthy();
  });
});

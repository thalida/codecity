import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { LegendTab } from '@/panes/InfoPane/tabs/LegendTab/LegendTab';
import { InfoPane } from '@/panes/InfoPane/InfoPane';
import { LAYER_LEGEND } from '@/panes/InfoPane/almanac';
import { flush } from '../../_helpers/preact';

describe('LegendTab', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders every layer + its cue rows from the single source, keyed by section accent', () => {
    render(<LegendTab />, container);
    for (const layer of LAYER_LEGEND) {
      const block = container.querySelector(`.legend-layer[data-section="${layer.key}"]`);
      expect(block, `block for ${layer.key}`).toBeTruthy();
      const text = block!.textContent ?? '';
      expect(text).toContain(layer.title);
      expect(text).toContain(layer.lead);
      for (const cue of layer.cues) {
        expect(text, `${layer.key} cue ${cue.label}`).toContain(cue.label);
        expect(text, `${layer.key} cue ${cue.detail}`).toContain(cue.detail);
      }
    }
  });

  it('keeps all visible copy free of em-dashes (house style: colons/commas)', () => {
    render(<LegendTab />, container);
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

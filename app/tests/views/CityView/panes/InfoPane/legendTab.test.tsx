import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { LegendTab } from '@/views/CityView/panes/InfoPane/tabs/LegendTab/LegendTab';
import { InfoPane } from '@/views/CityView/panes/InfoPane/InfoPane';
import { LAYER_LEGEND } from '@/views/CityView/panes/InfoPane/almanac';
import { flush } from '../../../../_helpers/preact';
import { makeSession, renderInProject } from '../../../../_helpers/project';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

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
    renderInProject(<LegendTab />, session, container);
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
    renderInProject(<LegendTab />, session, container);
    expect(container.querySelector('.legend')!.textContent).not.toContain('—');
  });

  it('is reachable as the Legend subtab', async () => {
    const sig = signal(null);
    renderInProject(<InfoPane manifest={sig as never} />, session, container);
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

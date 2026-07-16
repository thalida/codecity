import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { ExcludesSection } from '@/views/ControlsPane/partials/ExcludesSection';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { EXCLUDES, addExclude } from '@/state/stores/excludes';
import { flush } from '../_helpers/preact';

function mount(ui: preact.VNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(ui, host);
  return host;
}

beforeEach(() => {
  EXCLUDES.value = {};
  CURRENT_SOURCE.value = { src: 's', branch: undefined };
});

describe('ExcludesSection', () => {
  it('lists active excludes and removes on click', async () => {
    addExclude('vendor');
    addExclude('a.md');
    const host = mount(<ExcludesSection />);
    expect(host.textContent).toContain('vendor');
    expect(host.textContent).toContain('a.md');
    const removeVendor = host.querySelector<HTMLButtonElement>('button[aria-label="Restore vendor"]');
    removeVendor!.click();
    await flush(); // signal-driven re-render is microtask-scheduled
    expect(host.textContent).not.toContain('vendor');
  });

  it('shows an empty state when nothing is excluded', () => {
    const host = mount(<ExcludesSection />);
    expect(host.textContent).toMatch(/nothing excluded/i);
  });
});

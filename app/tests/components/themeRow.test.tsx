import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { ThemeRow } from '@/components/ThemeRow/ThemeRow';
import { flush } from '../_helpers/preact';

describe('ThemeRow layout B', () => {
  let container: HTMLDivElement;
  afterEach(() => {
    if (container) {
      render(null, container);
      container.remove();
    }
  });
  const mount = (ui: preact.ComponentChild) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    render(ui as never, container);
  };

  it('shows the tip as an inline description when present', async () => {
    mount(
      <ThemeRow label="Max floors" tip="Floors for the largest file.">
        <input />
      </ThemeRow>
    );
    await flush();
    const desc = container.querySelector('.theme-row-desc');
    expect(desc?.textContent).toBe('Floors for the largest file.');
  });

  it('renders no description element when tip is absent', async () => {
    mount(
      <ThemeRow label="Saturation">
        <input />
      </ThemeRow>
    );
    await flush();
    expect(container.querySelector('.theme-row-desc')).toBeNull();
  });

  it('marks the row inline when inline is set (toggle/color)', async () => {
    mount(
      <ThemeRow label="Enabled" inline>
        <input type="checkbox" />
      </ThemeRow>
    );
    await flush();
    expect(container.querySelector('.theme-row')?.classList.contains('theme-row--inline')).toBe(
      true
    );
  });

  it('is stacked (not inline) by default', async () => {
    mount(
      <ThemeRow label="Speed">
        <input />
      </ThemeRow>
    );
    await flush();
    expect(container.querySelector('.theme-row')?.classList.contains('theme-row--inline')).toBe(
      false
    );
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { InterfaceThemeSection } from '@/views/ControlsPane/partials/InterfaceThemeSection';
import {
  ACCENT_THEME,
  ACCENT_THEME_DEFAULT,
  SURFACE_THEME,
  SURFACE_THEME_DEFAULT,
} from '@/state/stores/settings/theme';
import { flush } from '../../_helpers/preact';

describe('InterfaceThemeSection', () => {
  let container: HTMLDivElement;

  const mount = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => render(<InterfaceThemeSection />, container));
  };

  const radio = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (el) => el.getAttribute('aria-label') === label
    )!;

  afterEach(() => {
    ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
    SURFACE_THEME.value = SURFACE_THEME_DEFAULT;
    render(null, container);
    container.remove();
  });

  it('renders two radiogroups (accent + surface)', () => {
    mount();
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(2);
  });

  it('marks the active accent chip aria-checked', () => {
    mount();
    expect(radio('Blue').getAttribute('aria-checked')).toBe('true');
    expect(radio('Cyan').getAttribute('aria-checked')).toBe('false');
  });

  it('selecting a chip write-through-applies to the store and <html>', async () => {
    mount();
    act(() => radio('Cyan').click());
    await flush();
    expect(ACCENT_THEME.value).toBe('cyan');
    expect(document.documentElement.getAttribute('data-cc-accent')).toBe('cyan');
    expect(radio('Cyan').getAttribute('aria-checked')).toBe('true');
  });

  it('arrow key moves selection and focus together (radiogroup pattern)', async () => {
    mount();
    // Rainbow order is [amber, green, cyan, blue, purple, pink]; blue is the
    // default/active, so ArrowRight lands on purple.
    const blue = radio('Blue');
    blue.focus();
    act(() => {
      blue.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await flush();
    expect(ACCENT_THEME.value).toBe('purple');
    expect(document.activeElement).toBe(radio('Purple'));
  });

  it('reset returns the axis to its default', async () => {
    mount();
    act(() => radio('Warm').click());
    await flush();
    expect(SURFACE_THEME.value).toBe('warm');
    const surfaceReset = container.querySelectorAll<HTMLButtonElement>('.theme-row-reset')[1];
    act(() => surfaceReset.click());
    await flush();
    expect(SURFACE_THEME.value).toBe(SURFACE_THEME_DEFAULT);
  });
});

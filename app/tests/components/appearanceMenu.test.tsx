import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { AppearanceMenu } from '@/components/menus/AppearanceMenu/AppearanceMenu';
import {
  ACCENT_THEME,
  ACCENT_THEME_DEFAULT,
  SURFACE_THEME,
  SURFACE_THEME_DEFAULT,
} from '@/state/settings/fields/theme';
import { flush } from '../_helpers/preact';

describe('AppearanceMenu', () => {
  let container: HTMLDivElement;

  const mount = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => render(<AppearanceMenu />, container));
    act(() => container.querySelector<HTMLButtonElement>('.popover-trigger')!.click());
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

  // It opens upward from the footer, so the panel must not be anchored to the
  // trigger's lower edge the way the header's is.
  it('opens a panel that rises from the trigger', () => {
    mount();
    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('popover-panel--above-start')).toBe(true);
  });

  it('renders two radiogroups (accent + surface) and the syntax picker', () => {
    mount();
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(2);
    expect(container.querySelector('select')).not.toBeNull();
  });

  it('marks the active accent chip aria-checked', () => {
    mount();
    expect(radio('Purple').getAttribute('aria-checked')).toBe('true');
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
    // Rainbow order is [amber, green, cyan, blue, purple, pink]; purple is the
    // default/active, so ArrowRight lands on pink.
    const purple = radio('Purple');
    purple.focus();
    act(() => {
      purple.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await flush();
    expect(ACCENT_THEME.value).toBe('pink');
    expect(document.activeElement).toBe(radio('Pink'));
  });

  it('reset returns the axis to its default', async () => {
    mount();
    act(() => radio('Warm').click());
    await flush();
    expect(SURFACE_THEME.value).toBe('warm');
    const surfaceReset = container.querySelectorAll<HTMLButtonElement>('.setting-row-reset')[1];
    act(() => surfaceReset.click());
    await flush();
    expect(SURFACE_THEME.value).toBe(SURFACE_THEME_DEFAULT);
  });
});

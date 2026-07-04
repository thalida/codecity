import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FilePreviewSection } from '@/views/ControlsPane/partials/FilePreviewSection';
import { SYNTAX_THEME, SYNTAX_THEME_DEFAULT } from '@/state/stores/settings/syntaxTheme';
import { commit, discard, _resetForTests } from '@/state/settingsDrafts';
import { flush } from '../../_helpers/preact';

describe('FilePreviewSection', () => {
  let container: HTMLDivElement;

  function mount(): HTMLElement {
    act(() => {
      render(<FilePreviewSection />, container);
    });
    return container;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SYNTAX_THEME.value = SYNTAX_THEME_DEFAULT;
    _resetForTests();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('changing the select stages a draft; does not instant-apply the signal', async () => {
    const pane = mount();
    const select = pane.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    act(() => {
      select.value = 'monokai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    // Staged, not applied: the committed signal must be untouched.
    expect(SYNTAX_THEME.value).toBe(SYNTAX_THEME_DEFAULT);

    act(() => commit());
    expect(SYNTAX_THEME.value).toBe('monokai');
  });

  it('discard after a change reverts the staged theme; signal stays default', async () => {
    const pane = mount();
    const select = pane.querySelector('select') as HTMLSelectElement;

    act(() => {
      select.value = 'monokai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(SYNTAX_THEME.value).toBe(SYNTAX_THEME_DEFAULT);

    act(() => discard());
    expect(SYNTAX_THEME.value).toBe(SYNTAX_THEME_DEFAULT);
  });
});

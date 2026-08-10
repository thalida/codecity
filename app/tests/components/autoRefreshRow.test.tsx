import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { AutoRefreshRow } from '@/components/AutoRefreshRow/AutoRefreshRow';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { SIDEBAR_COLLAPSED, SIDEBAR_TAB } from '@/state/stores/ui';
import { SidebarTab } from '@/types/ui';
import { flush } from '../_helpers/preact';

describe('AutoRefreshRow', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true, POLL_SECONDS: 5 };
    SIDEBAR_COLLAPSED.value = true;
    SIDEBAR_TAB.value = SidebarTab.Info;
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    CURRENT_SOURCE.value = null;
  });

  const toggle = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

  it('is a live toggle for a local folder, showing the cadence', async () => {
    CURRENT_SOURCE.value = { src: '/Users/thalida/repo' };
    render(<AutoRefreshRow />, container);
    await flush();

    expect(toggle().disabled).toBe(false);
    expect(toggle().checked).toBe(true);
    expect(container.textContent).toContain('every 5s');
  });

  it('writes the setting through, with no Save step', async () => {
    CURRENT_SOURCE.value = { src: '/Users/thalida/repo' };
    render(<AutoRefreshRow />, container);
    await flush();

    toggle().checked = false;
    toggle().dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush();
    expect(LIVE_UPDATES.value.ENABLED).toBe(false);
  });

  it('sends the cadence to the settings that own it', async () => {
    CURRENT_SOURCE.value = { src: '/Users/thalida/repo' };
    render(<AutoRefreshRow />, container);
    await flush();

    container.querySelector<HTMLButtonElement>('.auto-refresh-cadence')!.click();
    await flush();
    expect(SIDEBAR_TAB.value).toBe(SidebarTab.Controls);
    expect(SIDEBAR_COLLAPSED.value).toBe(false);
  });

  describe('on a remote source, where the poll never runs', () => {
    beforeEach(() => {
      CURRENT_SOURCE.value = { src: 'https://github.com/o/r', branch: 'main' };
    });

    it('keeps the row and its switch, so the menu does not change shape', async () => {
      render(<AutoRefreshRow />, container);
      await flush();
      expect(toggle()).not.toBeNull();
      expect(container.textContent).toContain('Auto-refresh');
    });

    it('shows the switch off and not operable, whatever the setting says', async () => {
      // ENABLED stays true: the setting is global, and the next local project
      // should honour it. What must not happen is a live-looking toggle for
      // something that cannot run here.
      render(<AutoRefreshRow />, container);
      await flush();
      expect(LIVE_UPDATES.value.ENABLED).toBe(true);
      expect(toggle().checked).toBe(false);
      expect(toggle().disabled).toBe(true);
    });

    it('says why, in place of the cadence', async () => {
      render(<AutoRefreshRow />, container);
      await flush();
      expect(container.textContent).toContain('only for local folders');
      expect(container.querySelector('.auto-refresh-cadence')).toBeNull();
    });
  });
});

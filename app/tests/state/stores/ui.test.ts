import { describe, it, expect, afterEach } from 'vitest';
import { effect } from '@preact/signals';
import {
  PROJECTS_VIEW,
  openProjectsView,
  closeProjectsView,
  OVERLAY_OPEN,
} from '@/state/stores/ui';
import { CURRENT_SOURCE } from '@/state/stores/source';

afterEach(() => {
  closeProjectsView();
  CURRENT_SOURCE.value = null;
});

describe('PROJECTS_VIEW', () => {
  it('opens with opts and closes', () => {
    openProjectsView({ dismissible: true });
    expect(PROJECTS_VIEW.value.visible).toBe(true);
    expect(PROJECTS_VIEW.value.opts.dismissible).toBe(true);
    expect(OVERLAY_OPEN.value).toBe(true);
    closeProjectsView();
    expect(PROJECTS_VIEW.value.visible).toBe(false);
    expect(OVERLAY_OPEN.value).toBe(false);
  });

  it('opening while a source is loaded does not self-close (closeProjectsView peeks)', () => {
    // Reproduces the "Switch project does nothing" bug: App reacts to
    // CURRENT_SOURCE and calls closeProjectsView() from inside an effect. If
    // closeProjectsView read PROJECTS_VIEW.value (tracked), the effect would
    // subscribe to PROJECTS_VIEW and re-fire on every open — snapping the view
    // shut again while a city is loaded. peek() must keep it keyed on
    // CURRENT_SOURCE alone.
    CURRENT_SOURCE.value = { src: 'https://github.com/o/loaded' };
    const dispose = effect(() => {
      if (CURRENT_SOURCE.value) closeProjectsView();
    });

    openProjectsView({ dismissible: true });
    expect(PROJECTS_VIEW.value.visible).toBe(true); // stays open, not snapped shut

    dispose();
  });
});

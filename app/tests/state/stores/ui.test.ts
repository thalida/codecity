import { describe, it, expect } from 'vitest';
import { PROJECTS_VIEW, openProjectsView, closeProjectsView, MODAL_OPEN } from '@/state/stores/ui';

describe('PROJECTS_VIEW', () => {
  it('opens with opts and closes', () => {
    openProjectsView({ dismissible: true });
    expect(PROJECTS_VIEW.value.visible).toBe(true);
    expect(PROJECTS_VIEW.value.opts.dismissible).toBe(true);
    expect(MODAL_OPEN.value).toBe(true);
    closeProjectsView();
    expect(PROJECTS_VIEW.value.visible).toBe(false);
    expect(MODAL_OPEN.value).toBe(false);
  });
});

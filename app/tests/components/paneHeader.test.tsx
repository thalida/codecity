// The header's close button doesn't close anything: it puts a panel away, and a
// right-sidebar selection outlives it. The glyph has to say which panel and
// which direction, so it's chosen from the sidebar the pane is rendered in.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { PaneHeader } from '@/components/PaneHeader/PaneHeader';
import { Sidebar, SidebarSide } from '@/components/Sidebar/Sidebar';

describe('PaneHeader close button', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const closeIcon = () =>
    container.querySelector('button[aria-label="Hide sidebar"] svg') as SVGElement;

  const mountInSidebar = (side: SidebarSide) =>
    render(
      <Sidebar id="s" side={side} open>
        <PaneHeader title="Pane" onClose={() => {}} />
      </Sidebar>,
      container
    );

  it('collapses toward the right edge inside the right sidebar', () => {
    mountInSidebar(SidebarSide.Right);
    expect(closeIcon().classList.contains('lucide-panel-right-close')).toBe(true);
  });

  it('collapses toward the left edge inside the left sidebar', () => {
    mountInSidebar(SidebarSide.Left);
    expect(closeIcon().classList.contains('lucide-panel-left-close')).toBe(true);
  });

  it('falls back to an × with no sidebar edge to collapse toward', () => {
    render(<PaneHeader title="Pane" onClose={() => {}} />, container);
    expect(closeIcon().classList.contains('lucide-x')).toBe(true);
  });
});

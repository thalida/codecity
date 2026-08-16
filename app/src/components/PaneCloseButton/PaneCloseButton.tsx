// components/PaneCloseButton/PaneCloseButton.tsx — puts a panel away rather
// than closing anything, so it draws it collapsing toward its own edge.

import { useContext } from 'preact/hooks';
import { PanelLeftClose, PanelRightClose, X } from 'lucide-preact';
import { SidebarSideContext, SidebarSide } from '@/components/Sidebar/Sidebar';

export interface PaneCloseButtonProps {
  onClose: () => void;
  /** Tooltip / aria-label. Defaults to "Hide sidebar". */
  title?: string;
}

/** The close button puts a panel away rather than closing anything, so it draws
 *  it collapsing toward its edge. Outside a sidebar, × is right again. */
export function PaneCloseButton({ onClose, title = 'Hide sidebar' }: PaneCloseButtonProps) {
  const side = useContext(SidebarSideContext);
  const Icon =
    side === SidebarSide.Right ? PanelRightClose : side === SidebarSide.Left ? PanelLeftClose : X;
  return (
    <button
      type="button"
      class="btn-icon"
      title={title}
      aria-label={title}
      onClick={() => onClose()}
    >
      <Icon class="icon" />
    </button>
  );
}

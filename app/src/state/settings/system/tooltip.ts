// state/settings/system/tooltip.ts — Tooltip placement. Consumed by
// views/components/tooltip.ts.

import { signal } from '@preact/signals';

export interface TooltipConfig {
  OFFSET_PX: number;
  VIEWPORT_MARGIN_PX: number;
}

export const TOOLTIP = signal<TooltipConfig>({
  OFFSET_PX: 14, // distance from cursor
  VIEWPORT_MARGIN_PX: 4, // safety margin from viewport edges
});

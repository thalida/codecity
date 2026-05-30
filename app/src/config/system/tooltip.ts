// config/system/tooltip.ts — Tooltip placement. Consumed by
// views/components/tooltip.ts.

import { map } from 'nanostores';

export interface TooltipConfig {
  OFFSET_PX: number;
  VIEWPORT_MARGIN_PX: number;
}

export const TOOLTIP = map<TooltipConfig>({
  OFFSET_PX: 14, // distance from cursor
  VIEWPORT_MARGIN_PX: 4, // safety margin from viewport edges
});

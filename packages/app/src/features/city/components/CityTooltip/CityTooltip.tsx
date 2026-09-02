// features/city/components/CityTooltip/CityTooltip.tsx — this app's hover card,
// passed to <City> as `components.Tooltip`. The package ships a plain one with
// the name and the path; this says what the panes would say about the same
// node, so hovering and selecting cannot disagree about a file's numbers.

import './CityTooltip.css';
import { useCity, useScrub, type CityTooltipProps } from '@codecity/city/preact';

import { hoverTooltipContent } from '@/features/city/components/CityTooltip/tooltipContent';
import { usePointer } from '@/features/city/components/CityTooltip/usePointer';

export function CityTooltip({ target }: CityTooltipProps) {
  const city = useCity();
  const scrub = useScrub();
  const at = usePointer();

  const content = hoverTooltipContent(
    target,
    city?.manifest?.tree?.name ?? null,
    (path) => scrub?.statsFor(path ?? '') ?? null
  );
  if (!content || !at) return null;

  return (
    <div
      class="card-tooltip surface-glass"
      style={{ transform: `translate(${at.x + 14}px, ${at.y + 14}px)` }}
    >
      <div class="tooltip-title">
        {content.deleted ? <span class="tooltip-deleted">deleted</span> : null}
        {content.deleted ? ' ' : null}
        {content.title}
      </div>
      {content.path ? <div class="tooltip-path">{content.path}</div> : null}
      {content.stats.length > 0 ? (
        <div class="tooltip-stats">{content.stats.join('  ·  ')}</div>
      ) : null}
    </div>
  );
}

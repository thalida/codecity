// preact/CityTooltip.tsx — the card that follows the cursor over what it is
// hovering. Shipped as the default so a bare <City> is useful on its own, and
// replaceable through `components` so a host that wants to say more can.

import './CityTooltip.css';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { NodeKind } from '../types/manifest';
import type { PickTarget } from '../types/picker';
import { useCityHover } from './hooks';

/** What a tooltip is given: what the pointer is over, and nothing else. Where
 *  the pointer IS stays the card's own business — the city would otherwise have
 *  to report a position sixty times a second for it. */
export interface CityTooltipProps {
  target: PickTarget | null;
}

/** The name a node goes by, and where it lives. A host wanting sizes, ages or
 *  languages writes its own and passes it as `components.Tooltip`. */
function describe(target: PickTarget): { title: string; path?: string } {
  switch (target.kind) {
    case NodeKind.File:
      return { title: target.file.name, path: target.file.path ?? undefined };
    case NodeKind.Directory:
      return { title: target.dir.name, path: target.dir.path ?? undefined };
    case NodeKind.Commit:
      return { title: target.commit.sha.slice(0, 7), path: target.commit.subject };
    case NodeKind.Gem:
      return { title: 'This repository' };
    default:
      return { title: '' };
  }
}

export function DefaultCityTooltip({ target }: CityTooltipProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  // The pointer is a DOM fact this already has; only what it is OVER comes
  // from the city.
  useEffect(() => {
    const track = (e: PointerEvent) => setAt({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', track);
    return () => window.removeEventListener('pointermove', track);
  }, []);

  if (!target || !at) return null;
  const { title, path } = describe(target);
  return (
    <div
      class="codecity-tooltip"
      style={{ transform: `translate(${at.x + 14}px, ${at.y + 14}px)` }}
    >
      <div class="codecity-tooltip-title">{title}</div>
      {path ? <div class="codecity-tooltip-path">{path}</div> : null}
    </div>
  );
}

/** Mounted inside the overlay, so it reads the city it is drawn over. */
export function HoverTooltip({ Tooltip }: { Tooltip: ComponentType<CityTooltipProps> }) {
  return <Tooltip target={useCityHover()} />;
}

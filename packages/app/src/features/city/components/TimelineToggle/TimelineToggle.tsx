// features/city/components/TimelineToggle/TimelineToggle.tsx — prominent Live/Timeline
// toggle centered at the bottom of the scene (above the time-travel bar).

import { useSourceInfo } from '@/features/city/hooks/useSourceInfo';
import './TimelineToggle.css';

import { useCityTimeline } from '@codecity/city/preact';
import { setUrlTimelineMode } from '@/router/cityUrl';

export function TimelineToggle() {
  const sourceInfo = useSourceInfo();
  const timeline = useCityTimeline().mode;
  if (!sourceInfo.src) return null;
  return (
    <div class="timeline-toggle surface-glass" role="group" aria-label="Scene mode">
      <button
        type="button"
        class={`timeline-toggle-btn${timeline ? '' : ' is-active'}`}
        aria-pressed={!timeline}
        onClick={() => timeline && setUrlTimelineMode(false)}
      >
        Live
      </button>
      <button
        type="button"
        class={`timeline-toggle-btn${timeline ? ' is-active' : ''}`}
        aria-pressed={timeline}
        onClick={() => !timeline && setUrlTimelineMode(true)}
      >
        Timeline
      </button>
    </div>
  );
}

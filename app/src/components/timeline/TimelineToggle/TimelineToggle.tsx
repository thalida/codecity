// components/timeline/TimelineToggle/TimelineToggle.tsx — prominent Live/Timeline
// toggle centered at the bottom of the scene (above the time-travel bar).

import './TimelineToggle.css';
import { SOURCE_INFO } from '@/state/stores/source';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { loadTimelineScene, exitTimelineMode } from '@/hooks/useTimelineMode';

export function TimelineToggle() {
  if (!SOURCE_INFO.value.src) return null;
  const timeline = TIMELINE_MODE.value;
  return (
    <div class="timeline-toggle surface-glass" role="group" aria-label="Scene mode">
      <button
        type="button"
        class={`timeline-toggle-btn${timeline ? '' : ' is-active'}`}
        aria-pressed={!timeline}
        onClick={() => timeline && exitTimelineMode()}
      >
        Live
      </button>
      <button
        type="button"
        class={`timeline-toggle-btn${timeline ? ' is-active' : ''}`}
        aria-pressed={timeline}
        onClick={() => !timeline && void loadTimelineScene()}
      >
        Timeline
      </button>
    </div>
  );
}

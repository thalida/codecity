// components/timeline/TimelineToggle/TimelineToggle.tsx — prominent Live/Timeline
// toggle centered at the bottom of the scene (above the time-travel bar).

import './TimelineToggle.css';
import { useProject } from '@/state/project/context';

export function TimelineToggle() {
  const { source, timeline: history, timelineMode } = useProject();
  const timeline = history.mode.value;
  if (!source.info.value.src) return null;
  return (
    <div class="timeline-toggle surface-glass" role="group" aria-label="Scene mode">
      <button
        type="button"
        class={`timeline-toggle-btn${timeline ? '' : ' is-active'}`}
        aria-pressed={!timeline}
        onClick={() => timeline && timelineMode.exit()}
      >
        Live
      </button>
      <button
        type="button"
        class={`timeline-toggle-btn${timeline ? ' is-active' : ''}`}
        aria-pressed={timeline}
        onClick={() => !timeline && void timelineMode.loadScene()}
      >
        Timeline
      </button>
    </div>
  );
}

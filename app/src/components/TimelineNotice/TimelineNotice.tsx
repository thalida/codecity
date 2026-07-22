// components/TimelineNotice/TimelineNotice.tsx — a brief auto-dismissing toast
// shown when the user selects a building/street while scrubbing the timeline.
// The details panel is suppressed in Timeline mode (its data would be the union
// city, not a real scan at that commit), so this explains why nothing opened.
// Commit selections are unaffected — they open the panel normally.

import './TimelineNotice.css';
import { useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { NodeKind } from '@/types';

const MESSAGE = "Details aren't available while scrubbing the timeline";
const LINGER_MS = 2600;

export function TimelineNotice() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useSignalEffect(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    // Only file/dir selections while scrubbing — commits open the panel, and
    // clearing the selection shouldn't fire the toast.
    if (!TIMELINE_MODE.value) return;
    if (sel?.kind !== NodeKind.File && sel?.kind !== NodeKind.Directory) return;
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), LINGER_MS);
  });

  if (!visible) return null;
  return (
    <div class="timeline-notice" role="status">
      {MESSAGE}
    </div>
  );
}

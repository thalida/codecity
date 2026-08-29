// chrome/CityStage — the stage the city is performed on: the canvas, the
// selection chip, and the scene controls that sit over it.

import './CityStage.css';
import { SceneCity } from '@/components/City/SceneCity';
import { TimelineScrubber } from '@/components/timeline/TimelineScrubber/TimelineScrubber';
import { TimelineToggle } from '@/components/timeline/TimelineToggle/TimelineToggle';
import { SelectionChip } from '@/views/CityView/chrome/CityStage/SelectionChip/SelectionChip';

export function CityStage() {
  return (
    <div id="city-stage">
      <SceneCity />
      <SelectionChip />
      <div id="scene-controls">
        <TimelineScrubber />
        <TimelineToggle />
      </div>
    </div>
  );
}

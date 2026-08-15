// chrome/CityStage — the stage the city is performed on: the canvas, the
// selection chip, and the scene controls that sit over it.

import './CityStage.css';
import { City } from '@/city/City';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';
import { SceneModeToggle } from '@/components/SceneModeToggle/SceneModeToggle';
import { SelectionChip } from '@/components/SelectionChip/SelectionChip';

export function CityStage() {
  return (
    <div id="city-stage">
      <City />
      <SelectionChip />
      <div id="scene-controls">
        <TimeTravelBar />
        <SceneModeToggle />
      </div>
    </div>
  );
}

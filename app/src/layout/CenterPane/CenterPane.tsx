// layout/CenterPane.tsx — the center column. Holds the <City /> component,
// which owns the canvas + the Three.js scene lifecycle.

import './CenterPane.css';
import { City } from '@/city/City';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';
import { SceneModeToggle } from '@/components/SceneModeToggle/SceneModeToggle';
import { SelectionChip } from '@/components/SelectionChip/SelectionChip';

export function CenterPane() {
  return (
    <div id="center-pane">
      <City />
      <SelectionChip />
      <div id="scene-controls">
        <TimeTravelBar />
        <SceneModeToggle />
      </div>
    </div>
  );
}

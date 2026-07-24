// layout/CenterPane.tsx — the center column. Holds the <City /> component,
// which owns the canvas + the Three.js scene lifecycle.

import './CenterPane.css';
import { City } from '@/components/City';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';
import { SceneModeToggle } from '@/components/SceneModeToggle/SceneModeToggle';

export function CenterPane() {
  return (
    <div id="center-pane">
      <City />
      <div id="scene-controls">
        <TimeTravelBar />
        <SceneModeToggle />
      </div>
    </div>
  );
}

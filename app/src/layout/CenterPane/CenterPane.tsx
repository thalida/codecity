// layout/CenterPane.tsx — the center column. Holds the <City /> component,
// which owns the canvas + the Three.js scene lifecycle.

import './CenterPane.css';
import { City } from '@/components/City';
import { TimeTravelBar } from '@/components/TimeTravelBar/TimeTravelBar';

export function CenterPane() {
  return (
    <div id="center-pane">
      <City />
      <TimeTravelBar />
    </div>
  );
}

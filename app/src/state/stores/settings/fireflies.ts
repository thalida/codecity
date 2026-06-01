// state/stores/settings/fireflies.ts — committer-fireflies tunables.
//
// Glowing motes that orbit each commit-tree, colored per author. BOB is the
// y-axis sinusoid the shader applies to displace each orb; PULSE is a
// brightness modulation; per-author commit-count scaling is always on (tune
// spread via SCALE_MIN/MAX). Schema-driven (see state/schema).

import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/schema';

const FIREFLIES_FIELDS = {
  ENABLED: { route: ChangeRoute.Rebuild, kind: FieldKind.Toggle, default: true, label: 'Fireflies enabled',
    tip: 'Master toggle. When off, no firefly orbs are placed or rendered. Rebuild on change.' },

  SCALE_MIN: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.5, min: 0.1, max: 2.0, step: 0.05, label: 'Scale min',
    tip: 'Multiplier for the author with the fewest commits. Rebuild on change.' },
  SCALE_MAX: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 2.5, min: 0.5, max: 5.0, step: 0.05, label: 'Scale max',
    tip: 'Multiplier for the author with the most commits. Rebuild on change.' },

  ORBIT_SPEED: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.3, min: 0, max: 3.0, step: 0.05, label: 'Orbit speed',
    tip: 'How fast each firefly orbits its tree, radians/sec. 0 = stationary.' },
  BOB_AMPLITUDE: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 2.0, step: 0.05, label: 'Bob amplitude',
    tip: 'How far each orb drifts up and down in world units. 0 = no vertical movement.' },
  BOB_SPEED: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 1.1, min: 0, max: 5.0, step: 0.1, label: 'Bob speed',
    tip: 'How fast the vertical bob oscillates in radians/sec. Higher = faster bobbing.' },

  EMISSION_STRENGTH: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 1.5, min: 0, max: 5.0, step: 0.1, label: 'Emission strength',
    tip: 'Base brightness multiplier. >1 makes orbs glow (bloom). Lower = subtler.' },
  PULSE_AMPLITUDE: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1.0, step: 0.05, label: 'Pulse amplitude',
    tip: 'Brightness swing. 0 = steady glow, 1 = full ±100% modulation.' },
  PULSE_SPEED: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 1.5, min: 0, max: 5.0, step: 0.1, label: 'Pulse speed',
    tip: 'How fast the pulse oscillates, radians/sec.' },
  FLICKER_AMOUNT: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.75, min: 0, max: 1.0, step: 0.05, label: 'Flicker',
    tip: 'Random brightness jitter on top of the pulse. 0 = smooth, 1 = jittery.' },

  ORBIT_RING_ENABLED: { route: ChangeRoute.Rebuild, kind: FieldKind.Toggle, default: true, label: 'Show orbit ring',
    tip: "Draws a subtle ring around each tree showing the firefly's orbital path." },
  ORBIT_RING_THICKNESS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.15, min: 0.02, max: 0.5, step: 0.01, label: 'Ring thickness',
    tip: 'Tube radius of the orbit ring in world units. Rebuilds geometry on change.' },
} satisfies FieldMap;

export const FIREFLIES = settingSignal('FIREFLIES', FIREFLIES_FIELDS);
export type FirefliesConfig = ConfigOf<typeof FIREFLIES_FIELDS>;

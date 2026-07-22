// Pass-through over the generated schema (not hand-mirrored like manifest.ts) — read in only a couple of places.
import type { components } from './manifest.generated';

export type TimelineBundle = components['schemas']['TimelineBundle'];
export type TimelineDelta = components['schemas']['TimelineDelta'];
export type TimelineChange = components['schemas']['TimelineChange'];
export type TimelineProgress = components['schemas']['TimelineProgressEvent'];

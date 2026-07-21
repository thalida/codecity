// types/timeline.ts — thin pass-through aliases for the timeline-bundle wire
// types. Unlike manifest.ts (hand-mirrored + contract-guarded), these are
// consumed as-generated: no ergonomic hand copy is worth it for a bundle
// that's read in only a couple of places (T2 replay, T1 fetch).
import type { components } from './manifest.generated';

export type TimelineBundle = components['schemas']['TimelineBundle'];
export type TimelineDelta = components['schemas']['TimelineDelta'];
export type TimelineChange = components['schemas']['TimelineChange'];

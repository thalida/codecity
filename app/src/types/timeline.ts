// Pass-through over the generated schema, bar the stage discriminant: an enum,
// so call sites compare members rather than loose strings (manifest.contract.ts
// holds it to the wire).
import type { components } from './manifest.generated';

export type TimelineBundle = components['schemas']['TimelineBundle'];
export type TimelineDelta = components['schemas']['TimelineDelta'];
export type TimelineChange = components['schemas']['TimelineChange'];

// Which part of the timeline build a progress tick reports. Values are the wire
// form; the server's TimelineStage is the source of truth.
export enum TimelineStage {
  Fetch = 'fetch',
  History = 'history',
  Blobs = 'blobs',
  Assemble = 'assemble',
}

export type TimelineProgress = Omit<components['schemas']['TimelineProgressEvent'], 'stage'> & {
  stage: TimelineStage;
};

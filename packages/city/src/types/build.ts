// city/types/build.ts — the stages a build runs through, as its progress events
// report them. What each stage is CALLED, and how a consumer turns the sequence
// into a progress readout, belong to the consumer: the city says what it is
// doing, not how to phrase it.

export enum BuildStage {
  /** Timeline only: the SERVER assembling the union bundle. Not the client's
   *  work at all, but the same row's wait, so it counts as the first stage. */
  Assembling = 'assembling',
  /** Timeline only: the bundle replayed into per-path timelines, ahead of the
   *  pack. Declared by the caller that runs it, not by the apply. */
  Replay = 'replay',
  /** The roof-icon atlas, rebuilt only when the structure signature changed. */
  Icons = 'icons',
  /** The packer: the worker on a structure change, a cheap in-JS reuse otherwise. */
  Layout = 'layout',
  /** The batch that swaps manifest + layout, and the mesh rebuilds it fires. */
  Assemble = 'assemble',
  /** The deferred pass: tree placement off-thread, then its meshes. Runs with
   *  the city already up, and outlives the overlay in Live. */
  Decorate = 'decorate',
}

// scene/components/trees/treePlacementProtocol.ts — Shared message constants for the tree-
// placement worker protocol. Imported by both treePlacementWorker.ts
// and treePlacementClient.ts so both sides use the exact same string
// discriminants (typoed 'place_result' vs 'place-result' would be a
// silently dropped message).

export const MSG = {
  REQUEST: 'place' as const,
  RESPONSE_OK: 'place-result' as const,
  RESPONSE_ERROR: 'place-error' as const,
};

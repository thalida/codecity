// Per-instance building render kind (the iKind attribute). Mirror these float
// values in building.vert/frag.glsl.
export const BuildingKind = {
  Normal: 0,
  Ruin: 1, // Timeline: deleted → crumbled gray stub
  Future: 2, // Timeline: not-yet-created → blank low slab
  Data: 3, // binary "data" file → windowless facade
  Empty: 4, // 0-byte file → flat slab, no walls or windows
} as const;

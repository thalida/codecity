// Per-instance building render kind (the iKind attribute). building.frag.glsl
// redeclares these as `const int KIND_*`; building-shader.test.ts asserts the
// two agree, since drift would silently render a whole class of buildings in
// the wrong mode.
export const BuildingKind = {
  Normal: 0,
  Ruin: 1, // Timeline: deleted → crumbled gray stub
  Future: 2, // Timeline: not-yet-created → blank low slab
  Data: 3, // binary "data" file → windowless facade
  Empty: 4, // 0-byte file → flat slab, no walls or windows
} as const;

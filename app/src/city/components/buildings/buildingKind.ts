// Per-instance render kind (iKind). building.frag.glsl redeclares these as
// `const int KIND_*`; building-shader.test.ts asserts the two agree.
export const BuildingKind = {
  Normal: 0,
  Ruin: 1, // Timeline: deleted → crumbled gray stub
  Data: 2, // binary "data" file → windowless facade
  Empty: 3, // 0-byte file → flat slab, no walls or windows
  Unmeasured: 4, // size never fetched → translucent shell, contents unknown
} as const;

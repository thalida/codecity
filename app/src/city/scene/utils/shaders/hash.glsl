// hash.glsl — shared hash-without-sine helpers (Dave Hoskins).
// The classic fract(sin(x) * 43758.5453) hash needs sin() of arguments that
// grow with time/index; desktop GPUs range-reduce those correctly, but mobile
// GPUs (Adreno/Mali) return garbage or NaN past a few thousand — NaN that the
// bloom blur then smears into rectangular blocks. These stay exact at any
// magnitude (fract/dot only).

// One value from one seed.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// One value from a 2D seed (e.g. window col/row).
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One value from a 3D seed (e.g. star cell x/y + cube face).
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Three values from a 3D seed.
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

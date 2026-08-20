# Facade panels

The image and video billboards on media-file buildings, drawn as four
InstancedMesh faces per building (South, North, East, West).

## Why the z-offset exists

`depthWrite: false` on the panel material makes `polygonOffset` a no-op, so the
world-unit offset from the building's front face is the only thing keeping the
panel quad out of co-planar z-fighting with the wall. It is tuned to clear
typical 8–96 unit-wide buildings at oblique angles.

## LOD, and why it measures one reference panel

The thresholds are the on-screen height (CSS px) that a **reference** panel (the
tallest in the repo) would project to at a given camera distance. Both the
whole-mesh early-out (measured at the nearest panel) and the per-instance cull
(measured at each panel) use that one reference height rather than each panel's
own, so panels at the same distance always decide together. Per-panel heights
gave a finicky mixed row: a small file's short billboard culling while a big
one's tall billboard beside it stayed.

Panels are transparent, DoubleSide and never frustum-culled, so a distant one is
a sub-pixel speck contributing pure overdraw — hiding it, and not loading it, is
free. Hysteresis (cull below HIDE, restore above SHOW) stops a panel at the
boundary flickering while OrbitControls damps.

## Why loads are budgeted per frame

A media-heavy repo (PostHog: ~1.4k images) otherwise fires every fetch, base64
decode, canvas scale and GPU upload in one burst on load, and that main-thread
work janks navigation while it drains. Starting a few per frame, and only for
on-screen panels, spreads the cost so zooming and rotating stay smooth as
billboards stream in.

## Disposal

Async load tasks that started before `dispose()` and finish after it — likely
during a skeleton → final or live-update rebuild — check the disposed flag
before touching `iTextureFade`, or they clobber the new instance's slot state.

## Why the mesh opts out of frustum culling

Three.js culls an InstancedMesh by the _geometry's_ bounding sphere — a tiny
unit-plane sphere at the origin — ignoring per-instance transforms. Rotate the
camera so the origin leaves view and the whole mesh vanishes while its panels
are still on screen. Per-instance frustum testing would be the principled fix,
but slot count is bounded (≤1024 in practice), so always-draw is cheap and
correct. The per-instance LOD pass does its own sphere test, using a radius
around each building's center so a large building at the screen edge still
counts as on-screen.

## Why renderOrder is forced above buildings AND street labels

Buildings, street labels and facade panels are all `transparent: true`, so they
sort by renderOrder first and camera distance second. The panel mesh's bounding
sphere sits at world origin (instance transforms live in `instanceMatrix`, and
`mesh.position` is never set), so it sorts as if it were at (0,0,0). For any
building away from the origin — everywhere, in practice — the panel mesh reads
as _farther_ than the building mesh, so a back-to-front sort would draw panels
first and the building (with `depthWrite: true`) would overwrite them. Panels
would be invisible on exactly the walls facing the camera.

It must also out-rank street labels: both have `depthWrite: false`, and a panel
hangs past its wall by the front-face offset, so otherwise the road-name plane
wins the painter sort and bleeds through the overhang.

## Why the material is DoubleSide

With FrontSide, floating-point precision in the winding-order check can flip a
panel to back-facing slightly before it is edge-on in screen space, popping it
out of view while it should still be a thin sliver. At true edge-on the panel
has zero pixel area either way, so DoubleSide costs essentially nothing.

## Why loads funnel through a semaphore

Beyond the per-frame start budget, in-flight requests are capped. Without it a
media-heavy repo (Infisical: 2.6k images) fires thousands of `<img>.src` at
once, which exhausts the browser's per-origin HTTP/1.1 connection pool (6) and
queues the rest until they time out — leaving many buildings stuck on the
placeholder — and starves other tabs of GPU time during the `texSubImage3D`
burst after decode. Four concurrent slots sits under the pool size, paces the
uploads, and keeps the main thread responsive.

Image bytes come from `GET /api/file`, one request per building, fetched as a
Blob outside the slot so only decode plus upload is gated. Reading the status
rather than pointing an `<img>` at the URL is what lets a `202` (not downloaded
yet) keep the placeholder instead of tinting the building as broken. Videos take
the URL directly: only the first frame is needed, and `<video>` streams just
enough to grab it.

Both URLs carry the file's mtime (or its blob sha under a scrub), so a rebuild
re-reads them from the browser cache instead of the network.

## Failure states

A failed upload tints the slots with the sticky error color rather than ramping
the fade, because sampling an unwritten texture layer at `iTextureFade = 1`
produces fully transparent fragments — a missing billboard rather than a broken
one. The distinction from the loading placeholder is what says "this one is not
coming back" instead of "still waiting". A data facade that fails just keeps its
sealed placeholder, which is a valid look, so it gets no error tint. A file the
server hasn't downloaded yet keeps the placeholder too: it is waiting, not
broken, and the next rebuild picks it up once the fetch lands.

## The video play-button overlay

Drawn over the first-frame poster so a video reads as a video at thumbnail
scale. The fractions are visual-feel constants: the background circle is 18% of
the shorter canvas dimension (readable small, without crowding the corners), the
triangle's apex-to-base distance is 55% of that circle (leaving a thin black
halo), its half-base is 55% of that distance (a roughly equilateral wedge), and
its half-height 85% (matching a standard play glyph).

## Shader page count

`FACADE_PANEL_MAX_PAGES` is injected as a `#define`: it sizes the `uPanelArrays`
sampler array and gates the `sampleLayer` dispatch branches, so the page count
lives in one constant. The sampler array is padded to that size so every
declared slot is bound; unused slots reuse page 0 and are never sampled, since
`iLayerIndex` stays within capacity.

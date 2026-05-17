# Manual smoke tests

The vitest suite covers shader source structure, geometry math, atlas
packing, picker logic, and other unit-testable behavior. It does **not**
cover the integration between the renderer and its consumers — picker,
fader, ghosts, outlines, controls, animator. Those have all been broken
at least once by refactors that passed the unit suite.

Run this checklist after any change that touches:

- `web/scene/cityScene.ts`, `web/scene/picker.ts`, `web/scene/inputHandlers.ts`
- `web/scene/instanced/*` or `web/scene/shaders/*`
- `web/scene/effects/*` (fader, outlineRenderer, ghostRenderer, pathLineRenderer)
- `web/scene/lodController.ts`, `web/scene/animator.ts`
- `web/config/*` or `web/main.ts`'s `applyTheme` / `attachHotReload` wiring

## Setup

```sh
( cd web && npm run build )
uv run codecity .                  # run on this repo for a real-world scene
# or
uv run codecity codecity/tests/fixtures/sample-repo
```

Two tabs: keep the running app + the controls pane visible.

## Hover + tooltip

| | |
|---|---|
| Hover a foreground building | Tooltip shows the **file's path** ("web/scene/cityScene.ts · 15 lines") |
| Move cursor between two buildings in the same block | Tooltip text **updates** on each new building (regression: stuck on first) |
| Hover a sidewalk | Tooltip shows the **directory's path** ("web/scene · 24 files, X dirs") |
| Hover the gem | Cursor changes; no tooltip |
| Hover a far building (one whose block has swapped to placeholder LOD) | Tooltip shows the directory path (placeholder represents the whole block) |
| Hover empty space | No tooltip; cursor returns to grab |
| Move cursor at high speed across the city | Tooltip + cursor never lock up; outline + ghost don't flicker |

## Click / selection

| | |
|---|---|
| Click a building | Sidebar populates with file metadata; selected outline (white) appears around the building; ghost overlay disappears |
| Click another building | Previous outline animates out; new outline animates in |
| Click a sidewalk | Sidebar shows directory metadata; sidewalk highlights |
| Click a placeholder cuboid | Sidebar shows directory metadata for the block it represents |
| Click the gem | Camera resets to default view |
| Click empty space | Selection clears; sidebar returns to default |

## Media buildings (image + video files)

| | |
|---|---|
| Load any repo containing image or video files (the codecity repo itself works) | Each media file renders as a full building cuboid — facade, windows, aging — NOT the old panel-on-posts billboard |
| Look at a media building from any orbit angle | A glowing ad panel is visible on whichever face(s) you're looking at (ads sit on all 4 vertical faces) |
| Inspect the front face (door side) | Door is **uncovered** — there's a clean strip of building wall in the bottom margin below the ad |
| Find a media file with a tall portrait image (or a small media building) | Ad's top extends above the building roof — Times-Square wraparound effect |
| Click the ad panel | Selects the file (right sidebar pane swaps in), same as clicking the building wall |
| Select an unrelated file | Media building's cuboid AND its ad panels fade together (no half-fade where ads stay bright while building dims) |
| Open controls pane → `AD_PANEL` group | Four controls present: side margin, bottom offset, front-face offset, placeholder color |
| Drag `AD_SIDE_MARGIN_FRAC` from 0.10 → 0.25 | Ads shrink horizontally on rebuild — bigger margins of building wall visible to the sides |
| Drag `AD_BOTTOM_OFFSET_FLOORS` from 1.0 → 2.0 | Ads lift higher on the building face |
| Drag `BLOOM.AD_EMISSION` from 0.9 → 0.5 | Ads dim — emission drops without rebuild |
| Video media file's ad | Shows the ▶ play overlay baked into the texture; clicking plays the video in the sidebar pane |

## Hover ghost (translucent overlay)

| | |
|---|---|
| Hover a building (not the selected one) | Translucent ghost appears at that building's position with the building's color |
| Move cursor between buildings in the same block | Ghost **moves** with the cursor (regression: stuck on first building of block) |
| Hover the currently selected building | Ghost is hidden (selected outline already marks it) |
| Hover-then-click a building | Ghost vanishes the moment selection commits |
| Watch a building during its enter animation, hover it | Ghost tracks the animator's tween (grows with the building) |

## Fade tiers (`BUILDING_FADE` config in Controls pane)

Default config: `DEFAULT=Full, NEAR=Silhouette, FAR=Hidden` with outlines
on for NEAR + FAR.

With a building selected:

| | |
|---|---|
| Selected building | Full facade with windows, full opacity, white selection outline |
| Buildings in the same directory (Default tier) | Full facade — same as the selected one |
| Buildings one hop away (Near = Silhouette) | Solid color body with **front-vs-side shading** (no windows / no door / no slabs); thin outline at edges |
| Buildings 2+ hops away (Far = Hidden) | Body invisible; **only the wireframe edges visible**; **road behind shows through** |

Then in the Controls pane → Buildings → Fade:

| | |
|---|---|
| Drag `DEFAULT_BODY_OPACITY` from 1.0 → 0.3 | Default-tier buildings dim **immediately** (regression: dial does nothing until you re-hover) |
| Change `NEAR_DETAIL` from Silhouette → Full | Near-tier buildings render windows again, immediately |
| Change `FAR_DETAIL` from Hidden → Silhouette | Far-tier buildings get a faint solid body instead of just wireframe |
| Toggle `NEAR_OUTLINE` off | Near-tier wireframes disappear |

## LOD swap (zoom)

| | |
|---|---|
| Zoom out far enough that a block's pixel-area drops below `SWAP_TO_PLACEHOLDER_PX` | Block's individual buildings vanish; a single colored cuboid (mean color of buildings) appears in their place |
| Zoom back in past `SWAP_TO_DETAIL_PX` | Cuboid vanishes; individual buildings reappear |
| At intermediate zoom (between thresholds) | No flicker — hysteresis holds whichever state was current |

## Animations

| | |
|---|---|
| Refresh the page | All buildings scale-fade-in from the ground (entry animation) |
| Edit a tracked file on disk and wait for the live-update poll | Modified file's building animates (height change, color change) without a full reload |
| Add a new tracked file | New building scale-fades-in |
| Delete a tracked file | Building scale-fades-out |
| Hover a building during a scale-fade-in | Selection outline + ghost both follow the animator's tween |

## Controls pane (every row should live-update)

Walk every section. For each control, change the value and confirm the
scene reacts **without a page reload**:

| Section | Sample control | Verify |
|---|---|---|
| Background | `GROUND` color picker | Scene background changes |
| Streets | `ASPHALT.COLOR` | Street meshes recolor |
| Streets | `LABEL_TYPOGRAPHY.FONT_SIZE_PX` | All street labels resize (debounced rebuild — ~50 ms wait) |
| Streets | `SIDEWALK_COLORS.DEFAULT` | All sidewalks recolor |
| Buildings | `BUILDING_DIMENSIONS.MAX_FLOORS` | All buildings rebuild at new heights (debounced) |
| Buildings | `BUILDING_PALETTE` (any) | Buildings rehue (debounced rebuild) |
| Buildings | `BUILDING_OUTLINE.COLOR` | Hover/selection outlines recolor immediately |
| Buildings | `BUILDING_FADE.DEFAULT_BODY_OPACITY` | Default-tier opacity changes immediately |
| Gem | `GEM_APPEARANCE.EDGE_COLOR` | Gem edge color changes |
| Gem | `GEM_SIZING.RADIUS_FRAC` | Gem resizes (debounced rebuild) |
| Effects | `RAINBOW.SPEED` | Selected path-line chase speed changes (read per frame) |
| Updates | `LIVE_UPDATES.POLL_SECONDS` | Polling interval changes; check Network tab to confirm |
| Updates | `SCAN_FILTERS.SHOW_ALL_FILES` | Server refetches manifest with untracked + gitignored files |

If any row changes the value but the scene doesn't react: the store is
either missing from `web/config/hotReload.ts`'s lists or its consumer
isn't subscribing. Both have been bug sources during the InstancedMesh
refactor.

## Visual regression (frozen reference comparison)

```sh
( cd web && npm run test:visual:verify )
```

Three poses (top-down, orbit-30, close-block) compared to `web/tests/visual/references/`.
1% pixel-tolerance per pose. Sub-pixel CDN-icon drift in the sidebar can
push top-down to ~1% — known noise. If the canvas portion of the diff
exceeds 1%, the shader has regressed.

## Performance baseline

Open Chrome DevTools → Performance. Record while orbiting for 5 s on a
large repo (15k+ buildings). Confirm:

- Average FPS ≥ 60.
- No frame > 32 ms during normal orbit.
- Memory profile stable (no per-frame allocations leaking — animator + fader should be O(active tweens) not O(buildings)).

If frames spike during cursor movement, the picker is the most likely
culprit — confirm `three-mesh-bvh` is patched and `computeBoundsTree()`
ran on each block's geometry.

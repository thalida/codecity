# When the city is actually on screen

The loading overlay used to come down when the build returned. On a big repo
that left seconds of empty canvas: a finished build means the meshes exist and
the buffers are filled, not that anything has been drawn with them. Between the
two sit shader compilation for each material and the upload of every instanced
buffer and texture array — all of it on the first frame that touches them.

`Idle` is what says so. `applyStructure` used to set it the moment it returned,
but the rebuilds it starts are async and it holds none of them — so the composer
sets it instead, once `buildings.whenSettled()` resolves and a frame carrying
those meshes has been **presented**. Nothing else is needed: every status before
Idle already means "still coming".

## Why two rAFs

`renderer.render()` returns once the GL commands are issued, not once pixels
land: the driver is still working and the compositor has not run. There is no
"the user can see it now" callback in WebGL. Two `requestAnimationFrame`s is the
practical stand-in — the first fires before the frame is presented, the second
after — so the flag flips a frame late rather than a frame early. A frame late
is invisible; a frame early is the bug.

`renderer.info.render.frame` does not answer this. It counts frames issued.

## Error still releases it

A build that errored will never present anything, so the overlay cannot wait for
a frame that is not coming. `Error` ends the wait and shows the failure.

## What the overlay does with it

`Idle` is the _only_ thing that takes the loading overlay down. Not the stream
ending, not the heights landing: a scan streams three cities (structure, then
per-file metadata, then git history), and the last of them is the one with
trees in it, because commits are what trees are made of. Lifting at metadata
revealed a correct-looking city that then grew trees under you, so the overlay
now waits out the git walk too — the `Reading history` row is that wait.

The cost is honest: a cold scan of a big repo holds the overlay through minutes
of `git log`. Cancel is right there, and every row says which stage is running.

A build with no stream behind it raises the overlay by itself. Re-opening the
project you were just in never fetches anything — the manifest is still in hand
— but leaving `/city` unmounted the canvas, so the whole city gets packed again
from scratch. That rebuild is the entire wait, and it used to run behind a blank
stage. `CITY_ON_SCREEN` is what tells the two apart: a rebuild UNDER a city (a
settings Save, a live update) is the footer's to report, not the overlay's.

The landing's wallpaper builds through this same pipeline and is _not_ the
world, so it reports through a silent `BuildReporter`. Otherwise its `markIdle`
left "a city is on screen" true for a canvas the landing had already thrown
away, and the next open skipped its overlay.

## Everything downstream gets this for free

`captureHarness` waits for `Idle` before taking a screenshot, and used to be
able to shoot a city that had not been drawn.

## What this does not do

It does not make the stall shorter, only honest: the work now happens behind the
overlay instead of behind a blank city. `renderer.compileAsync(scene, camera)`
before the first render would move shader compilation off the critical frame and
is the next thing to try — but measure first, with a `performance.mark` either
side of the first render, because if the time is dominated by texture upload
rather than compilation then `compileAsync` buys little.

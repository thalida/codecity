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

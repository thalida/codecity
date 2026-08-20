# When the city is actually on screen

The loading overlay used to come down when the build returned. On a big repo
that left seconds of empty canvas: a finished build means the meshes exist and
the buffers are filled, not that anything has been drawn with them. Between the
two sit shader compilation for each material and the upload of every instanced
buffer and texture array — all of it on the first frame that touches them.

`CITY_ON_SCREEN` is the signal the overlay waits on instead. `markRebuilding`
clears it, and the frame loop sets it once a frame carrying the new city has
been **presented**.

## Why two rAFs

`renderer.render()` returns once the GL commands are issued, not once pixels
land: the driver is still working and the compositor has not run. There is no
"the user can see it now" callback in WebGL. Two `requestAnimationFrame`s is the
practical stand-in — the first fires before the frame is presented, the second
after — so the flag flips a frame late rather than a frame early. A frame late
is invisible; a frame early is the bug.

`renderer.info.render.frame` does not answer this. It counts frames issued.

## Why it is gated on Idle

A build that errored will never present anything, so holding the overlay for a
frame that cannot come would strand it. The wait applies only when the build
reached `Idle`; `Error` lets the overlay go and show the failure.

## What this does not do

It does not make the stall shorter, only honest: the work now happens behind the
overlay instead of behind a blank city. `renderer.compileAsync(scene, camera)`
before the first render would move shader compilation off the critical frame and
is the next thing to try — but measure first, with a `performance.mark` either
side of the first render, because if the time is dominated by texture upload
rather than compilation then `compileAsync` buys little.

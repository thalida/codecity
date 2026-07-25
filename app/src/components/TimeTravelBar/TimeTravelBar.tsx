// components/TimeTravelBar.tsx — bottom bar: scrubs SCRUB_POS across the timeline
// bundle's commit history. The track is a TIME axis (start/end date labels +
// one tick per commit positioned by date, so busy periods bunch up and quiet
// stretches spread), yet it drives SCRUB_POS as a float commit index so the
// scrub controller stays index-based. See scrubberScale for the date<->index map.

import './TimeTravelBar.css';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE, SCRUB_DRAGGING } from '@/state/stores/timeline';
import { ACCENT_THEME } from '@/state/stores/settings/theme';
import { SCRUBBER } from '@/state/stores/settings/scrubber';
import { formatShortDate } from '@/utils/dates';
import { commitUrl } from '@/utils/commit';
import {
  buildScrubberScale,
  commitFraction,
  indexToFraction,
  indexToMs,
  fractionToIndex,
} from './scrubberScale';

export function TimeTravelBar() {
  if (!TIMELINE_MODE.value) return null;

  const bundle = TIMELINE_BUNDLE.value;
  const commits = bundle?.commits ?? [];

  const indexWeight = SCRUBBER.value.INDEX_WEIGHT;
  const scale = useMemo(
    () =>
      buildScrubberScale(
        commits.map((c) => c.date),
        indexWeight
      ),
    // Rebuild only when the commit set or the axis shape changes, not per scrub.
    [commits, indexWeight]
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const maxIndex = Math.max(0, commits.length - 1);
  const pos = Math.min(Math.max(SCRUB_POS.value, 0), maxIndex);
  // A single-commit repo has no history to scrub: the handle pins to the present
  // (right edge, via the scale) and the track is inert rather than grab-and-freeze.
  const inert = maxIndex === 0;
  const accentTheme = ACCENT_THEME.value; // repaint the canvas when the accent changes

  // Paint the track: an accent played-fill + past ticks, neutral future ticks.
  // One canvas draw for all commits, DPR-crisp, null-guards a missing 2d context.
  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = track.clientWidth;
      const h = track.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cs = getComputedStyle(track);
      // Played fill + past ticks track the theme accent (matches the handle). The
      // resolved --cc-accent is passed straight to canvas; empty in headless
      // jsdom (no stylesheet) → the fallback, which node-canvas can parse.
      const accent = cs.getPropertyValue('--cc-accent').trim() || 'rgb(140, 110, 245)';
      const tick = cs.getPropertyValue('--tt-tick').trim() || 'rgba(148,151,168,0.5)';

      const cut = Math.floor(pos);
      const at = (i: number) => Math.round(commitFraction(scale, i) * (w - 1));

      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3; // played region wash
      ctx.fillRect(0, 0, Math.round(indexToFraction(scale, pos) * w), h);
      ctx.globalAlpha = 0.95; // past ticks
      for (let i = 0; i <= cut && i < scale.ms.length; i++) ctx.fillRect(at(i), 0, 1, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = tick; // future ticks
      for (let i = cut + 1; i < scale.ms.length; i++) ctx.fillRect(at(i), 0, 1, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(track);
    return () => ro.disconnect();
  }, [scale, pos, accentTheme]);

  if (commits.length === 0) return null;

  const commit = commits[Math.min(Math.round(pos), maxIndex)];
  const remote = bundle?.unionManifest?.repo?.remote_url ?? null;
  const url = remote ? commitUrl(remote, commit.sha) : null;
  const pct = indexToFraction(scale, pos) * 100;

  // "no commits" only when the handle is >4 days from the nearest commit (a real lull).
  const nearestIdx = Math.min(Math.round(pos), maxIndex);
  const handleMs = indexToMs(scale, pos);
  const inGap = Math.abs(handleMs - scale.ms[nearestIdx]) > 4 * 86_400_000;
  const gapDay = new Date(handleMs).toISOString().slice(0, 10);

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    SCRUB_POS.value = fractionToIndex(scale, (clientX - r.left) / r.width);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (inert) return;
    SCRUB_DRAGGING.value = true;
    // Optional-chained: jsdom (and old browsers) lack pointer capture.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (SCRUB_DRAGGING.peek()) setFromClientX(e.clientX);
  };
  const onPointerUp = (e: PointerEvent) => {
    SCRUB_DRAGGING.value = false;
    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture?.(e.pointerId);
    // Hand focus back to the scene so a pointer user's next R/F hits the camera
    // shortcuts (a focused slider would otherwise keep them here). Keyboard-only
    // users still Tab in and get the arrow/Home/End controls below.
    el.blur();
  };

  // Keyboard: arrows step one commit, Page keys ten, Home/End jump to the ends.
  // stopPropagation on the keys we own so Home/End don't ALSO fire the global
  // scene shortcuts (Home is bound to reset-view); unhandled keys (R, F) fall
  // through to the document handler.
  const onKeyDown = (e: KeyboardEvent) => {
    const cur = Math.round(pos);
    let next: number;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + 1;
    else if (e.key === 'PageDown') next = cur - 10;
    else if (e.key === 'PageUp') next = cur + 10;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = maxIndex;
    else return;
    e.preventDefault();
    e.stopPropagation();
    SCRUB_POS.value = Math.max(0, Math.min(maxIndex, next));
  };

  return (
    <div class="time-travel-bar">
      <div class="time-travel-scrubber">
        <button
          type="button"
          class="time-travel-edge"
          title="Jump to the first commit"
          onClick={() => (SCRUB_POS.value = 0)}
        >
          {formatShortDate(commits[0].date)}
        </button>
        <div
          ref={trackRef}
          class={`time-travel-track${inert ? ' is-inert' : ''}`}
          role="slider"
          tabIndex={inert ? -1 : 0}
          aria-label="Scrub commit history"
          aria-disabled={inert}
          aria-valuemin={0}
          aria-valuemax={maxIndex}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={
            inGap
              ? `${formatShortDate(gapDay)}, no commits`
              : `${formatShortDate(commit.date)}, commit ${commit.sha.slice(0, 7)}`
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvasRef} class="time-travel-ticks" aria-hidden="true" />
          <div class="time-travel-handle" style={{ left: `${pct}%` }} />
        </div>
        <button
          type="button"
          class="time-travel-edge"
          title="Jump to the latest commit"
          onClick={() => (SCRUB_POS.value = maxIndex)}
        >
          {formatShortDate(commits[maxIndex].date)}
        </button>
      </div>
      <div class="time-travel-info">
        <span class="time-travel-date">{formatShortDate(inGap ? gapDay : commit.date)}</span>
        {inGap ? (
          <span class="time-travel-subject time-travel-nocommit">no commits</span>
        ) : (
          <>
            {url ? (
              <a
                class="time-travel-sha"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title="View this commit on the remote"
              >
                {commit.sha.slice(0, 7)}
              </a>
            ) : (
              <span class="time-travel-sha">{commit.sha.slice(0, 7)}</span>
            )}
            <span class="time-travel-subject">{commit.subject || '(no subject)'}</span>
          </>
        )}
      </div>
    </div>
  );
}

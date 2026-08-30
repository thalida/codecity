// features/city/components/TimelineScrubber/TimelineScrubber.tsx — the scrub track. A time axis, so busy periods
// bunch and quiet stretches spread, driving SCRUB_POS as a float commit index so
// the scrub controller stays index-based. See scrubberScale for the mapping.

import { CITY_STORES } from '@/features/settings/state/values/city';
import './TimelineScrubber.css';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useCity, useCityTimeline } from '@codecity/city/preact';
import { ACCENT_THEME } from '@/features/settings/state/values/theme';
import { formatFullDate, formatShortDate, localDay } from '@/utils/dates';
import { showCommit } from '@/features/city/state/commands';
import { useCityChrome } from '@/features/city/state/sidebar';
import {
  buildScrubberScale,
  commitFraction,
  indexToFraction,
  indexToMs,
  fractionToIndex,
  snapToStop,
} from '@codecity/city';

export function TimelineScrubber() {
  // The reports drive the render; the engine takes the drag.
  const city = useCity();
  const chrome = useCityChrome();
  const timeline = useCityTimeline();
  const inTimeline = timeline.mode;
  const bundle = timeline.bundle;
  const commits = bundle?.commits ?? [];

  const indexWeight = CITY_STORES.SCRUBBER.value.INDEX_WEIGHT;
  const todayMs = timeline.todayMs;
  const scale = useMemo(
    () =>
      buildScrubberScale(
        commits.map((c) => c.date),
        indexWeight,
        todayMs
      ),
    // Rebuild only when the commit set or the axis shape changes, not per scrub.
    [commits, indexWeight, todayMs]
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const maxIndex = timeline.max;
  const pos = timeline.pos;
  // A single-commit repo has no history to scrub: the handle pins to the present
  // (right edge, via the scale) and the track is inert rather than grab-and-freeze.
  const inert = maxIndex === 0;
  const accentTheme = ACCENT_THEME.value; // repaint the canvas when the accent changes
  // Leaving Timeline destroys the canvas and returning builds a fresh blank one,
  // so the draw has to re-run on this even when nothing else changed.
  const mounted = inTimeline && commits.length > 0;

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
      // Resolved from CSS and handed to canvas, with a literal fallback for
      // headless jsdom, where there is no stylesheet to resolve.
      const accent = cs.getPropertyValue('--cc-accent').trim() || 'rgb(140, 110, 245)';
      const tick = cs.getPropertyValue('--tt-tick').trim() || 'rgba(148,151,168,0.5)';

      const cut = Math.floor(pos);
      const at = (i: number) => Math.round(commitFraction(scale, i) * (w - 1));

      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3; // played region wash
      ctx.fillRect(0, 0, Math.round(indexToFraction(scale, pos) * w), h);
      ctx.globalAlpha = 0.95; // past ticks
      for (let i = 0; i <= cut && i < scale.commitCount; i++) ctx.fillRect(at(i), 0, 1, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = tick; // future ticks
      for (let i = cut + 1; i < scale.commitCount; i++) ctx.fillRect(at(i), 0, 1, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(track);
    return () => ro.disconnect();
  }, [scale, pos, accentTheme, mounted]);

  // Bail only AFTER the hooks: returning above them froze this instance's effect
  // deps while it rendered nothing.
  if (!mounted) return null;

  // floor, not round: the scene gates at floor(pos), so rounding up names a
  // commit with no tree drawn. Capped, since the track runs one stop past.
  const lastCommit = commits.length - 1;
  const commit = commits[Math.min(Math.floor(pos), lastCommit)];
  const pct = indexToFraction(scale, pos) * 100;

  // The day the handle sits on, read local like the edge labels: on two
  // calendars, this row sat a day ahead of the dates on either side of it.
  const handleMs = indexToMs(scale, pos);
  const handleDay = localDay(handleMs);
  // A commit belongs to its own day and no other: carrying its message along
  // made it snap from one to the next while the date moved smoothly.
  const onCommitDay = localDay(scale.ms[Math.min(Math.floor(pos), lastCommit)]) === handleDay;
  // The right end of the axis, and whether the handle is standing on it.
  const endDay = todayMs == null ? commits[lastCommit].date : localDay(todayMs);
  const onToday = todayMs != null && handleDay === localDay(todayMs);

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const raw = fractionToIndex(scale, (clientX - r.left) / r.width);
    city?.timeline.setPosition(snapToStop(scale, indexToMs(scale, raw)));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (inert) return;
    city?.timeline.setDragging(true);
    // Optional-chained: jsdom (and old browsers) lack pointer capture.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (timeline.dragging) setFromClientX(e.clientX);
  };
  const onPointerUp = (e: PointerEvent) => {
    city?.timeline.setDragging(false);
    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture?.(e.pointerId);
    // Focus back to the scene, so the next R or F reaches the camera. Keyboard
    // users still Tab in for the controls below.
    el.blur();
  };

  // Arrows step one commit, Page ten, Home/End the ends. The keys this owns
  // stop propagating, or Home would also reset the view.
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
    city?.timeline.setPosition(next);
  };

  return (
    <div class="timeline-scrubber surface-glass">
      <div class="timeline-scrubber-thumb">
        <div
          ref={trackRef}
          class={`timeline-scrubber-track${inert ? ' is-inert' : ''}`}
          role="slider"
          tabIndex={inert ? -1 : 0}
          aria-label="Scrub commit history"
          aria-disabled={inert}
          aria-valuemin={0}
          aria-valuemax={maxIndex}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={
            onCommitDay
              ? `${formatShortDate(handleDay)}, commit ${commit.sha.slice(0, 7)}`
              : `${formatShortDate(handleDay)}, no commits`
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvasRef} class="timeline-scrubber-ticks" aria-hidden="true" />
          <div class="timeline-scrubber-handle" style={{ left: `${pct}%` }} />
        </div>
      </div>
      <div class="timeline-scrubber-axis">
        <button
          type="button"
          class="timeline-scrubber-edge"
          title={`Jump to the first commit: ${formatFullDate(commits[0].date)}`}
          onClick={() => city?.timeline.setPosition(0)}
        >
          {formatShortDate(commits[0].date)}
        </button>
        {/* The day the handle is on, always: the commit's own date held still
            until the handle was days clear of it, then jumped. */}
        <span class="timeline-scrubber-date" title={formatFullDate(handleDay)}>
          {onToday ? 'Today' : formatShortDate(handleDay)}
        </span>
        {/* The end of the track: today when the repo has aged since its last
            commit, so the city reads as it stands rather than as it was left. */}
        <button
          type="button"
          class="timeline-scrubber-edge"
          title={
            todayMs == null
              ? `Jump to the latest commit: ${formatFullDate(commits[lastCommit].date)}`
              : `Jump to today: ${formatFullDate(endDay)}`
          }
          onClick={() => city?.timeline.setPosition(maxIndex)}
        >
          {formatShortDate(endDay)}
        </button>
      </div>
      <div class="timeline-scrubber-info">
        {!onCommitDay ? (
          <span class="timeline-scrubber-subject timeline-scrubber-nocommit">no commits</span>
        ) : (
          // The whole row, not just the sha: the message is the larger half of
          // the target and reads as part of the same thing to click.
          <button
            type="button"
            class="timeline-scrubber-commit"
            title="Show this commit's details"
            onClick={() => showCommit(city, chrome, commit.sha)}
          >
            <span class="timeline-scrubber-sha">{commit.sha.slice(0, 7)}</span>
            <span class="timeline-scrubber-subject">{commit.subject || '(no subject)'}</span>
          </button>
        )}
      </div>
      {bundle && bundle.notes.length > 0 && (
        // Caveats about the data being scrubbed, so they sit under the track
        // rather than in a pane you might never open.
        <p class="timeline-scrubber-notes" role="note">
          {bundle.notes.join(' · ')}
        </p>
      )}
    </div>
  );
}

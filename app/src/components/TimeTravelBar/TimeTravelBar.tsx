// components/TimeTravelBar.tsx — bottom bar: scrubs SCRUB_POS across the timeline
// bundle's commit history. The track is a TIME axis (start/end date labels +
// one tick per commit positioned by date, so busy periods bunch up and quiet
// stretches spread), yet it drives SCRUB_POS as a float commit index so the
// scrub controller stays index-based. See scrubberScale for the date<->index map.

import './TimeTravelBar.css';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { formatShortDate } from '@/utils/dates';
import { commitUrl } from '@/utils/commit';
import {
  buildScrubberScale,
  commitFraction,
  indexToFraction,
  fractionToIndex,
} from './scrubberScale';

export function TimeTravelBar() {
  if (!TIMELINE_MODE.value) return null;

  const bundle = TIMELINE_BUNDLE.value;
  const commits = bundle?.commits ?? [];

  const scale = useMemo(
    () => buildScrubberScale(commits.map((c) => c.date)),
    // Rebuild only when the commit set changes (bundle swap), not on every scrub.
    [commits]
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  const maxIndex = Math.max(0, commits.length - 1);
  const pos = Math.min(Math.max(SCRUB_POS.value, 0), maxIndex);

  // Paint the track. Two signals encode played-vs-unplayed so it reads at ANY
  // tick density: (1) a solid accent fill over the scrubbed-past region — carries
  // sparse repos, where the bg shows between ticks; (2) two-tone ticks — past
  // commits in vivid purple, future in light — carries dense repos (react: 7k
  // ticks blanket the bg, so only tick COLOR can tell the sides apart). One canvas
  // draw for all commits, DPR-crisp, null-guards a missing 2d context.
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
      const played = cs.getPropertyValue('--tt-played').trim() || 'rgba(120,90,240,0.3)';
      const tickPlayed = cs.getPropertyValue('--tt-tick-played').trim() || 'rgba(150,110,255,0.95)';
      const tick = cs.getPropertyValue('--tt-tick').trim() || 'rgba(148,151,168,0.5)';

      ctx.fillStyle = played;
      ctx.fillRect(0, 0, Math.round(indexToFraction(scale, pos) * w), h);

      const cut = Math.floor(pos);
      const at = (i: number) => Math.round(commitFraction(scale, i) * (w - 1));
      ctx.fillStyle = tickPlayed;
      for (let i = 0; i <= cut && i < scale.ms.length; i++) ctx.fillRect(at(i), 0, 1, h);
      ctx.fillStyle = tick;
      for (let i = cut + 1; i < scale.ms.length; i++) ctx.fillRect(at(i), 0, 1, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(track);
    return () => ro.disconnect();
  }, [scale, pos]);

  if (commits.length === 0) return null;

  const commit = commits[Math.min(Math.round(pos), maxIndex)];
  const remote = bundle?.unionManifest?.repo?.remote_url ?? null;
  const url = remote ? commitUrl(remote, commit.sha) : null;
  const pct = indexToFraction(scale, pos) * 100;

  // "no commits" only when the handle is >4 days from the nearest commit (a real lull).
  const nearestIdx = Math.min(Math.round(pos), maxIndex);
  const handleMs = scale.minMs + indexToFraction(scale, pos) * scale.span;
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
    dragging.current = true;
    // Optional-chained: jsdom (and old browsers) lack pointer capture.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (dragging.current) setFromClientX(e.clientX);
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging.current = false;
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
          class="time-travel-track"
          role="slider"
          tabIndex={0}
          aria-label="Scrub commit history"
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

// views/widgets/pathTruncate.ts — middle-truncation algorithm for path breadcrumbs.
//
// Exported by the module so both appHeader.ts and filePreviewPane.ts can share
// the same logic without duplication.
//
// Usage:
//   fitSegments(containerEl, segmentEls, separatorEls)
//
// Set up a ResizeObserver on the container's parent to re-run on layout changes.

const ELLIPSIS_CLASS_HEADER = 'app-header-ellipsis';
const ELLIPSIS_CLASS_FILE = 'file-path-ellipsis';

/**
 * Determine the correct ellipsis class for the given container. Falls back to
 * the file-path class when the container is not inside `.app-header-crumbs`.
 */
function _ellipsisClass(container: HTMLElement): string {
  return container.classList.contains('app-header-crumbs')
    ? ELLIPSIS_CLASS_HEADER
    : ELLIPSIS_CLASS_FILE;
}

/** Remove any existing ellipsis placeholder from the container. */
function _removeEllipsis(container: HTMLElement): void {
  const cls = _ellipsisClass(container);
  container.querySelectorAll(`.${cls}`).forEach((el) => el.remove());
}

/**
 * Insert or update the `…` placeholder span at the DOM position of the first
 * hidden segment. The placeholder sits between the last visible leading
 * segment and the first visible trailing segment.
 *
 * The span's `title` lists all hidden segment labels so hovering reveals the
 * collapsed path.
 */
function _ensureEllipsisAt(
  container: HTMLElement,
  segments: HTMLElement[],
  separators: HTMLElement[],
  hiddenStart: number,
  hiddenEnd: number
): void {
  const cls = _ellipsisClass(container);

  // Build a tooltip with the names of all currently-hidden segments.
  const hiddenLabels: string[] = [];
  for (let i = hiddenStart; i <= hiddenEnd; i++) {
    if (segments[i].style.display === 'none') {
      hiddenLabels.push(segments[i].textContent ?? '');
    }
  }
  const tooltipText = `Hidden: ${hiddenLabels.join(' › ')}`;

  // Re-use an existing placeholder if present, or create a new one.
  let ellipsis = container.querySelector<HTMLElement>(`.${cls}`);
  if (!ellipsis) {
    ellipsis = document.createElement('span');
    ellipsis.className = cls;
    ellipsis.textContent = '…';

    // We need a separator before the ellipsis. Insert the ellipsis just
    // before segments[hiddenStart] — which is hidden — so visually it
    // appears between the last visible leading segment and the first
    // visible trailing segment.
    //
    // segments[hiddenStart] is still in the DOM (display:none), so we use
    // it as the insertBefore anchor.
    container.insertBefore(ellipsis, segments[hiddenStart]);
  }

  ellipsis.title = tooltipText;
}

/**
 * Fit path segments into `container` by hiding middle segments until the
 * content no longer overflows.
 *
 * @param container  The flex row that holds all segments and separators.
 * @param segments   Ordered segment elements (buttons / spans). Index 0 is
 *                   the leftmost segment, last index is the leaf.
 * @param separators Separator elements. `separators[i]` sits BETWEEN
 *                   `segments[i]` and `segments[i+1]`, i.e. immediately to
 *                   the LEFT of `segments[i+1]`. Length = segments.length - 1.
 */
export function fitSegments(
  container: HTMLElement,
  segments: HTMLElement[],
  separators: HTMLElement[]
): void {
  if (segments.length <= 2) return; // nothing to trim

  // Reset: show everything, remove any prior placeholder.
  segments.forEach((s) => {
    s.style.display = '';
  });
  separators.forEach((s) => {
    s.style.display = '';
  });
  _removeEllipsis(container);

  if (container.scrollWidth <= container.clientWidth) return; // already fits

  const last = segments.length - 1;
  const mid = Math.floor(segments.length / 2);

  let hiddenStart = -1;
  let hiddenEnd = -1;

  for (let radius = 0; radius < segments.length; radius++) {
    for (const idx of [mid - radius, mid + radius]) {
      // Never hide the first or last segment.
      if (idx <= 0 || idx >= last) continue;
      // Skip already-hidden.
      if (segments[idx].style.display === 'none') continue;

      segments[idx].style.display = 'none';

      if (hiddenStart === -1 || idx < hiddenStart) hiddenStart = idx;
      if (idx > hiddenEnd) hiddenEnd = idx;

      // Separator visibility: a separator should be hidden only when BOTH
      // segments on either side of it are hidden. The separators at the
      // boundary of the hidden block (just before the first hidden segment
      // and just after the last) stay visible — that's the `›` before
      // and after the ellipsis: e.g. `apps › api › … › fire-engine › leaf`.
      _syncSeparators(segments, separators);

      _ensureEllipsisAt(container, segments, separators, hiddenStart, hiddenEnd);

      if (container.scrollWidth <= container.clientWidth) return;
    }
  }
}

/**
 * Set `display: none` on a separator iff BOTH neighboring segments are hidden.
 * Otherwise show it. Called after each segment hide so the boundary `›` always
 * remains visible adjacent to the ellipsis placeholder.
 */
function _syncSeparators(segments: HTMLElement[], separators: HTMLElement[]): void {
  for (let i = 0; i < separators.length; i++) {
    const leftHidden = segments[i].style.display === 'none';
    const rightHidden = segments[i + 1].style.display === 'none';
    separators[i].style.display = leftHidden && rightHidden ? 'none' : '';
  }
}

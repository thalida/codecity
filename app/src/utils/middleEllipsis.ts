// utils/middleEllipsis.ts — middle-truncation for any inline list of
// segments + separators that needs to fit a fixed-width container.
//
// Caller passes:
//   - the flex/inline-row container
//   - the segment elements in order (segments[0] = leftmost; segments[N-1] = rightmost)
//   - the separator elements (separators[i] sits between segments[i] and segments[i+1])
//   - opts.ellipsisClass — CSS class to apply to the inserted `…` placeholder
//
// Algorithm: hide segments whole, outward from the middle, then the leading
// one. The last segment is never hidden — it names the thing you are looking
// at, and it truncates (CSS) only once no crumb is left to give.

interface ApplyMiddleEllipsisOpts {
  /** CSS class applied to the inserted `…` placeholder span. */
  ellipsisClass: string;
  /** The element whose width the content has to fit. Defaults to the container.
   *  Pass an ancestor when the container hugs its own content: a box sized by
   *  what's inside it can't overflow, so it would report a fit at any width and
   *  push whatever follows it out of the row. */
  budget?: HTMLElement | null;
}

/** The leaf can shrink, so a row that stopped overflowing may have managed it
 *  by cutting the one segment that has to go last. Both must hold. */
function _fits(box: HTMLElement, leaf: HTMLElement | undefined): boolean {
  if (box.scrollWidth > box.clientWidth) return false;
  // +1: scrollWidth/clientWidth are rounded, so a sub-pixel width reads as cut.
  return !leaf || leaf.scrollWidth <= leaf.clientWidth + 1;
}

function _removeEllipsis(container: HTMLElement, cls: string): void {
  container.querySelectorAll(`.${cls}`).forEach((el) => el.remove());
}

function _ensureEllipsisAt(
  container: HTMLElement,
  segments: HTMLElement[],
  hiddenStart: number,
  hiddenEnd: number,
  cls: string
): void {
  const hiddenLabels: string[] = [];
  for (let i = hiddenStart; i <= hiddenEnd; i++) {
    if (segments[i].style.display === 'none') {
      hiddenLabels.push(segments[i].textContent ?? '');
    }
  }
  const tooltipText = `Hidden: ${hiddenLabels.join(' › ')}`;

  let ellipsis = container.querySelector<HTMLElement>(`.${cls}`);
  if (!ellipsis) {
    ellipsis = document.createElement('span');
    ellipsis.className = cls;
    ellipsis.textContent = '…';
    // Insert before the first hidden segment (still in the DOM with
    // display:none) so the ellipsis sits where the hidden block starts.
    container.insertBefore(ellipsis, segments[hiddenStart]);
  }
  ellipsis.title = tooltipText;
}

/** Hide separator iff both neighboring segments are hidden. */
function _syncSeparators(segments: HTMLElement[], separators: HTMLElement[]): void {
  for (let i = 0; i < separators.length; i++) {
    const leftHidden = segments[i].style.display === 'none';
    const rightHidden = segments[i + 1].style.display === 'none';
    separators[i].style.display = leftHidden && rightHidden ? 'none' : '';
  }
}

export function applyMiddleEllipsis(
  container: HTMLElement,
  segments: HTMLElement[],
  separators: HTMLElement[],
  opts: ApplyMiddleEllipsisOpts
): void {
  segments.forEach((s) => {
    s.style.display = '';
  });
  separators.forEach((s) => {
    s.style.display = '';
  });
  _removeEllipsis(container, opts.ellipsisClass);

  const box = opts.budget ?? container;
  const last = segments.length - 1;
  const leaf = segments[last];
  if (_fits(box, leaf)) return;

  const mid = Math.floor(segments.length / 2);

  let hiddenStart = -1;
  let hiddenEnd = -1;

  for (let radius = 0; radius < segments.length; radius++) {
    for (const idx of [mid - radius, mid + radius]) {
      if (idx <= 0 || idx >= last) continue;
      if (segments[idx].style.display === 'none') continue;

      segments[idx].style.display = 'none';
      if (hiddenStart === -1 || idx < hiddenStart) hiddenStart = idx;
      if (idx > hiddenEnd) hiddenEnd = idx;

      _syncSeparators(segments, separators);
      _ensureEllipsisAt(container, segments, hiddenStart, hiddenEnd, opts.ellipsisClass);

      if (_fits(box, leaf)) return;
    }
  }

  // The leading crumb goes last of all the crumbs. Past here only the leaf is
  // left, and CSS truncates it.
  if (last > 0 && segments[0].style.display !== 'none') {
    segments[0].style.display = 'none';
    hiddenStart = 0;
    if (hiddenEnd < 0) hiddenEnd = 0;
    _syncSeparators(segments, separators);
    _ensureEllipsisAt(container, segments, hiddenStart, hiddenEnd, opts.ellipsisClass);
  }
}

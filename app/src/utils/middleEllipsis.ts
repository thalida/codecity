// utils/middleEllipsis.ts — middle-truncation for any inline list of
// segments + separators that needs to fit a fixed-width container.
//
// Caller passes:
//   - the flex/inline-row container
//   - the segment elements in order (segments[0] = leftmost; segments[N-1] = rightmost)
//   - the separator elements (separators[i] sits between segments[i] and segments[i+1])
//   - opts.ellipsisClass — CSS class to apply to the inserted `…` placeholder
//
// Algorithm: hide segments outward from the middle until the content fits.
// Segments[0] and segments[N-1] always stay visible. A `…` placeholder
// (with `class=opts.ellipsisClass`) is inserted at the first hidden position.
// Separators on either side of the hidden block stay visible (looks like
// `apps › api › … › fire-engine › leaf`).

interface ApplyMiddleEllipsisOpts {
  /** CSS class applied to the inserted `…` placeholder span. */
  ellipsisClass: string;
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
  if (segments.length <= 2) return;

  segments.forEach((s) => {
    s.style.display = '';
  });
  separators.forEach((s) => {
    s.style.display = '';
  });
  _removeEllipsis(container, opts.ellipsisClass);

  if (container.scrollWidth <= container.clientWidth) return;

  const last = segments.length - 1;
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

      if (container.scrollWidth <= container.clientWidth) return;
    }
  }
}

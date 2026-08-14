// city/layout/packProgress.ts — turns the packer's per-node ticks into a
// percent. Beside the worker rather than in it, so the throttle is testable
// without a Worker.

/** A reporter for `layoutCity`'s `onPlaced`, emitting whole percents only: a
 *  tick fires per node, 100k+ at Linux scale. An unknown `total` (0) opts out. */
export function createPackReporter(
  total: number,
  emit: (percent: number) => void
): (() => void) | undefined {
  if (total <= 0) return undefined;
  let placed = 0;
  let lastPercent = -1;
  return () => {
    placed++;
    // Caps at 99: the streets are joined and the result posted after the last
    // node lands, so 100 belongs to the layout-result message.
    const percent = Math.min(99, Math.floor((placed / total) * 100));
    if (percent === lastPercent) return;
    lastPercent = percent;
    emit(percent);
  };
}

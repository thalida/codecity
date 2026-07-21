import { apiUrl } from '@/api/apiUrl';
import { URL_PARAMS } from '@/constants/urlParams';
import type { TimelineBundle } from '@/types';

/** URL for the one-shot timeline bundle of an explicit source. */
export function timelineUrlFor(src: string, branch?: string): string {
  return apiUrl('timeline', { [URL_PARAMS.SRC]: src, [URL_PARAMS.BRANCH]: branch });
}

export async function fetchTimelineBundle(src: string, branch?: string): Promise<TimelineBundle> {
  const resp = await fetch(timelineUrlFor(src, branch));
  if (!resp.ok) throw new Error(`timeline fetch failed: ${resp.status}`);
  return (await resp.json()) as TimelineBundle;
}

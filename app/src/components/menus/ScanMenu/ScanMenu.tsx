// components/menus/ScanMenu/ScanMenu.tsx — the freshness readout as a trigger, over
// everything that decides how fresh the city gets to be: both ways to re-open
// the source, the auto-refresh settings, and what the scan is skipping.

import './ScanMenu.css';
import { Fragment } from 'preact';
import { EyeOff, RefreshCcwDot, RefreshCw, RotateCcw } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/menus/Popover/Popover';
import {
  FreshnessStatus,
  useFreshness,
} from '@/components/menus/ScanMenu/FreshnessStatus/FreshnessStatus';
import { Field } from '@/components/fields/Field/Field';
import { useMiddleEllipsis } from '@/hooks/useMiddleEllipsis';
import { useReplayAnimation } from '@/hooks/useReplayAnimation';
import { LIVE_UPDATES } from '@/state/settings/fields/updates';
import {
  CURRENT_SOURCE_IS_LOCAL,
  ACTIVE_EXCLUDES,
  removeExclude,
  clearExcludes,
} from '@/state/stores/source';
import { LOCAL_DOCS_URL, EXCLUDES_DOCS_URL } from '@/constants/ui';

const PANEL_LABEL = 'Scan and freshness';

/** Truncated from the middle: the tail of a rel-path (the filename) identifies
 *  it, and an end-ellipsis cuts exactly that off. */
function ExcludePath({ path }: { path: string }) {
  const ref = useMiddleEllipsis<HTMLSpanElement>(
    {
      segmentClass: 'excludes-seg',
      separatorClass: 'excludes-sep',
      ellipsisClass: 'excludes-ellipsis',
    },
    [path]
  );
  const segments = path.split('/').filter(Boolean);
  return (
    <span ref={ref} class="excludes-path text-mono" title={path}>
      {segments.map((seg, i) => (
        <Fragment key={`${i}-${seg}`}>
          {i > 0 && (
            <span class="excludes-sep" aria-hidden="true">
              /
            </span>
          )}
          <span class="excludes-seg">{seg}</span>
        </Fragment>
      ))}
    </span>
  );
}

function ExcludesGroup() {
  const paths = ACTIVE_EXCLUDES.value;
  return (
    <section class="popover-group">
      <div class="popover-group-head">
        {/* On the title, not each row: it says what the whole group is, and
            repeating it down the list adds a column without adding meaning. */}
        <EyeOff class="icon popover-group-icon" aria-hidden="true" />
        <h3 class="popover-group-title">Excluded from city</h3>
        {paths.length > 0 && (
          <button
            type="button"
            class="setting-row-reset"
            title="Restore all excluded paths"
            aria-label="Restore all excluded paths"
            onClick={clearExcludes}
          >
            <RotateCcw class="icon" />
          </button>
        )}
      </div>
      {paths.length === 0 ? (
        <p class="popover-empty">Nothing hidden from the city</p>
      ) : (
        <ul class="excludes-list">
          {paths.map((p) => (
            <li key={p} class="excludes-row">
              <ExcludePath path={p} />
              <button
                type="button"
                class="setting-row-reset"
                title={`Restore ${p}`}
                aria-label={`Restore ${p}`}
                onClick={() => removeExclude(p)}
              >
                <RotateCcw class="icon" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="popover-hint">
        Hidden in this browser only.{' '}
        <a class="link--chrome" href={EXCLUDES_DOCS_URL} target="_blank" rel="noopener noreferrer">
          What&rsquo;s&nbsp;excluded&nbsp;by&nbsp;default
        </a>
      </p>
    </section>
  );
}

/** The two ways to re-open the source, in the order you'd reach for them. */
const ACTIONS = [
  {
    id: 'reload',
    icon: RefreshCw,
    label: 'Reload',
    note: 'Rebuild the city from the cached scan',
    skipCache: false,
  },
  {
    id: 'fresh-scan',
    icon: RefreshCcwDot,
    label: 'Fresh scan',
    note: 'Ignore the cache and re-read the whole repo',
    skipCache: true,
  },
] as const;

export interface ScanMenuProps {
  /** Re-open the current source. `skipCache` ignores the server's cached scan
   *  and re-reads the repo from scratch. */
  onRefresh?: (skipCache: boolean) => void;
}

export function ScanMenu({ onRefresh }: ScanMenuProps) {
  const freshness = useFreshness();
  // Excluding is the one act whose result is an absence: the pane closes, the
  // building goes, and nothing else in the app says where it went.
  const hiddenCount = ACTIVE_EXCLUDES.value.length;
  const countRef = useReplayAnimation<HTMLSpanElement>(hiddenCount);
  const status = hiddenCount
    ? `${freshness.titleText} · ${hiddenCount} ${hiddenCount === 1 ? 'path' : 'paths'} hidden`
    : freshness.titleText;

  return (
    <>
      <Popover
        label={PANEL_LABEL}
        placement={PopoverPlacement.BelowEnd}
        triggerClass="scan-menu-trigger"
        triggerLabel={`${PANEL_LABEL}: ${status}`}
        triggerTitle={status}
        trigger={
          <>
            <FreshnessStatus freshness={freshness} />
            {hiddenCount > 0 && (
              <span ref={countRef} class="scan-menu-count">
                <EyeOff class="icon" aria-hidden="true" />
                {hiddenCount}
              </span>
            )}
          </>
        }
      >
        {(close) => (
          <>
            <section class="popover-group">
              {ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  class="btn-secondary popover-action scan-menu-action"
                  onClick={() => {
                    // No refocus: the reload replaces what's on screen.
                    close(false);
                    onRefresh?.(action.skipCache);
                  }}
                >
                  <action.icon class="icon scan-menu-action-icon" aria-hidden="true" />
                  <span class="scan-menu-action-label">{action.label}</span>
                  {/* On the row, not a tooltip: the two differ only in what they
                      do to the cache, which is the thing you're choosing between. */}
                  <span class="scan-menu-action-note">{action.note}</span>
                </button>
              ))}
            </section>

            <section class="popover-group">
              <Field store={LIVE_UPDATES} fieldKey="ENABLED" compact />
              <Field store={LIVE_UPDATES} fieldKey="POLL_SECONDS" compact />
              {/* Only where it explains something: on a clone the controls
                  above look live but nothing can change under them. */}
              {!CURRENT_SOURCE_IS_LOCAL.value && (
                <p class="popover-hint">
                  Local projects only.{' '}
                  <a
                    class="link--chrome"
                    href={LOCAL_DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    See&nbsp;local&nbsp;setup
                  </a>
                </p>
              )}
            </section>

            <ExcludesGroup />
          </>
        )}
      </Popover>
      {/* Standalone: a button's contents are only read on focus. */}
      <span class="sr-only" role="status">
        {status}
      </span>
    </>
  );
}

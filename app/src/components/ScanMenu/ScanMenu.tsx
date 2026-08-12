// components/ScanMenu/ScanMenu.tsx — the freshness readout as a trigger, over
// everything that decides how fresh the city gets to be.

import './ScanMenu.css';
import { Fragment } from 'preact';
import { EyeOff, RefreshCcwDot, RotateCcw } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/Popover/Popover';
import { FreshnessStatus, useFreshness } from '@/components/FreshnessStatus/FreshnessStatus';
import { Field } from '@/components/Field';
import { useMiddleEllipsis } from '@/hooks/useMiddleEllipsis';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { CURRENT_SOURCE_IS_LOCAL } from '@/state/stores/source';
import { ACTIVE_EXCLUDES, removeExclude, clearExcludes } from '@/state/stores/excludes';
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

export interface ScanMenuProps {
  /** Re-open the source ignoring the cached scan. Plain refresh is the button
   *  beside this one, so the panel lists only what that button isn't. */
  onFreshScan?: () => void;
}

export function ScanMenu({ onFreshScan }: ScanMenuProps) {
  const freshness = useFreshness();

  return (
    <>
      <Popover
        label={PANEL_LABEL}
        placement={PopoverPlacement.BelowEnd}
        triggerClass="scan-menu-trigger"
        triggerLabel={`${PANEL_LABEL} — ${freshness.titleText}`}
        triggerTitle={freshness.titleText}
        trigger={<FreshnessStatus freshness={freshness} />}
      >
        {(close) => (
          <>
            <section class="popover-group">
              <button
                type="button"
                class="btn-secondary scan-menu-action"
                title="Ignore the cache and re-read the whole repo"
                onClick={() => {
                  // No refocus: the rescan replaces what's on screen.
                  close(false);
                  onFreshScan?.();
                }}
              >
                {/* A refresh arrow, like the plain Refresh beside the trigger:
                    this is the same act, done harder. */}
                <RefreshCcwDot class="icon" aria-hidden="true" />
                Fresh scan
              </button>
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
        {freshness.titleText}
      </span>
    </>
  );
}

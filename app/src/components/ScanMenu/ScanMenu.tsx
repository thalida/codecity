// components/ScanMenu/ScanMenu.tsx — the freshness readout as a trigger, over
// everything that decides how fresh the city gets to be.
//
// A popover, not a modal: every control here changes the city behind it. Not
// role="menu": it mixes actions with form controls, and a menu takes only
// menuitems. No wrapper element: the trigger has to be a direct child of the
// chrome cluster for its dividers and end-rounding to apply.

import './ScanMenu.css';
import { Fragment } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import { useMiddleEllipsis } from '@/hooks/useMiddleEllipsis';
import { ChevronDown, EyeOff, RefreshCcwDot, RotateCcw } from 'lucide-preact';
import { CLUSTER_ITEM_PRESS } from '@/components/ChromeCluster/ChromeCluster';
import { FreshnessStatus, useFreshness } from '@/components/FreshnessStatus/FreshnessStatus';
import { Field } from '@/components/Field';
import { useDismissable } from '@/hooks/useDismissable';
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
    <section class="scan-menu-group">
      <div class="scan-menu-group-head">
        {/* On the title, not each row: it says what the whole group is, and
            repeating it down the list adds a column without adding meaning. */}
        <EyeOff class="icon scan-menu-group-icon" aria-hidden="true" />
        <h3 class="scan-menu-group-title">Excluded from city</h3>
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
        <p class="scan-menu-empty">Nothing hidden from the city</p>
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
      <p class="scan-menu-hint">
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
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const freshness = useFreshness();

  // Stable, so useDismissable doesn't resubscribe every render.
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  useDismissable(open, [trigger, panel], close);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={`${CLUSTER_ITEM_PRESS} scan-menu-trigger`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${PANEL_LABEL} — ${freshness.titleText}`}
        title={freshness.titleText}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <FreshnessStatus freshness={freshness} />
        <ChevronDown class="icon scan-menu-caret" aria-hidden="true" />
      </button>
      {/* Standalone: a button's contents are only read on focus. */}
      <span class="sr-only" role="status">
        {freshness.titleText}
      </span>

      {open && (
        <div
          ref={panel}
          class="scan-menu-panel surface-glass"
          role="dialog"
          aria-label={PANEL_LABEL}
        >
          {/* Sheet-only (hidden by CSS when anchored), and a real control: a
              grip that only decorates promises a drag it doesn't honour. */}
          <button
            type="button"
            class="scan-menu-grip"
            aria-label="Close"
            onClick={() => close(true)}
          />

          <section class="scan-menu-group">
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

          <section class="scan-menu-group">
            <Field store={LIVE_UPDATES} fieldKey="ENABLED" compact />
            <Field store={LIVE_UPDATES} fieldKey="POLL_SECONDS" compact />
            {/* Only where it explains something: on a clone the controls above
                look live but nothing can change under them. */}
            {!CURRENT_SOURCE_IS_LOCAL.value && (
              <p class="scan-menu-hint">
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
        </div>
      )}
    </>
  );
}

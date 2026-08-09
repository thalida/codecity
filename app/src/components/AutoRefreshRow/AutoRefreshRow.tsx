// components/AutoRefreshRow/AutoRefreshRow.tsx — the auto-refresh toggle, in
// the refresh menu's footer. It belongs with Refresh (same subject: keeping the
// city current) without being one of its actions, which is why it sits below a
// rule rather than among the menu items.
//
// The cadence is a LINK, not a second control. POLL_SECONDS is schema-defined
// with a min/max/step and clamped again at the caller; a number input here
// would be a second source of truth for a bounded value, and the two would
// disagree the first time one of them changed.
//
// On a remote source the row keeps its shape and goes inert: same label, same
// switch, muted, with the reason where the cadence would be. LIVE_UPDATES_ACTIVE
// is ENABLED && local, so the poll never runs for a clone. The switch is
// disabled rather than removed: dropping the row would leave the menu changing
// height per source, and a live-looking toggle would imply it could be turned
// on. The setting keeps its value either way, since it's global and the next
// local project should honour it.

import './AutoRefreshRow.css';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { CURRENT_SOURCE_IS_LOCAL } from '@/state/stores/source';
import { openSidebarTab } from '@/state/stores/ui';
import { SidebarTab } from '@/types/ui';
import { Toggle } from '@/components/Toggle/Toggle';

const TOGGLE_ID = 'auto-refresh-toggle';
const REMOTE_REASON = 'only for local folders';

export interface AutoRefreshRowProps {
  /** Called after the cadence link opens the settings, so the menu holding
   *  this row can close rather than sit over what it just pointed at. */
  onNavigate?: () => void;
}

export function AutoRefreshRow({ onNavigate }: AutoRefreshRowProps) {
  const live = LIVE_UPDATES.value;
  const isLocal = CURRENT_SOURCE_IS_LOCAL.value;

  return (
    <div class={`auto-refresh${isLocal ? '' : ' auto-refresh--inert'}`}>
      <span class="auto-refresh-text">
        <label class="auto-refresh-label" htmlFor={isLocal ? TOGGLE_ID : undefined}>
          Auto-refresh
        </label>{' '}
        {isLocal ? (
          <button
            type="button"
            class="auto-refresh-cadence link--chrome"
            onClick={() => {
              openSidebarTab(SidebarTab.Controls);
              onNavigate?.();
            }}
          >
            every {live.POLL_SECONDS}s
          </button>
        ) : (
          <small class="auto-refresh-reason">{REMOTE_REASON}</small>
        )}
      </span>
      <Toggle
        id={TOGGLE_ID}
        checked={isLocal && live.ENABLED}
        disabled={!isLocal}
        // Write-through: LIVE_UPDATES is markAutosave, so this applies now and
        // there is no Save step to explain.
        onCommit={(v) => (LIVE_UPDATES.value = { ...live, ENABLED: v })}
      />
    </div>
  );
}

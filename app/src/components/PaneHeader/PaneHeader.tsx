// components/PaneHeader.tsx — Shared header bar used by every pane
// (Tree, Search, Info, Controls on the left sidebar; file-preview on
// the right). Single source of truth for the `.pane-header` row +
// `.text-pane-title` + `.pane-header-close` triplet, so the panes look
// identical and adding a new pane is a one-call affair.

import './PaneHeader.css';
import type { ComponentChildren } from 'preact';
import { Focus, X, EyeOff, ExternalLink, PanelLeftClose, PanelRightClose } from 'lucide-preact';
import { createContext, type RefObject } from 'preact';
import { useContext, useRef } from 'preact/hooks';
import { CopyButton } from '@/components/CopyButton/CopyButton';
import { SidebarSide, SidebarSideContext } from '@/components/Sidebar/Sidebar';

// ── Props interface ─────────────────────────────────────────────────────────

export interface PaneHeaderProps {
  /** Initial title text. */
  title: string;
  /** Render the title in monospace — used by panes whose title is a
   *  filename / path identifier instead of a label. Defaults to false. */
  mono?: boolean;
  /** fn() when the user clicks the focus button. Omit to render no button. */
  onFocus?: () => void;
  /** Tooltip text on the focus button. Defaults to "Focus camera". */
  focusTitle?: string;
  /** Text the copy button copies (a path, a SHA). Omit to render no copy button. */
  copyText?: string;
  /** Tooltip / aria-label for the copy button. */
  copyLabel?: string;
  /** Open-on-origin URL (a commit/file/dir link). Omit to render no open link. */
  openUrl?: string | null;
  /** Tooltip / aria-label for the open link. */
  openLabel?: string;
  /** Extra action buttons rendered in the right-hand group, between the open link
   *  and exclude (e.g. CommitPane's view-on-timeline). */
  actionsSlot?: ComponentChildren;
  /** fn() when the user clicks the close button. Omit to render no button. */
  onClose?: () => void;
  /** Tooltip text on the close button. Defaults to "Hide sidebar". */
  closeTitle?: string;
  /** fn() when the user clicks the "exclude from city" button. Omit to render none. */
  onExclude?: () => void;
  /** Tooltip / aria-label for the exclude button. */
  excludeTitle?: string;
  /** Why this node can't be excluded. Set it and the button stays, dimmed and
   *  inert, carrying the reason: a rule you can see beats an affordance that
   *  silently isn't there. One field, not a flag plus a message, so a disabled
   *  button always has something to say for itself. */
  excludeDisabledReason?: string;
  /** Rich title content rendered inside the title element instead of the
   *  plain `title` string (e.g. a path breadcrumb, or "Commit <sha> · author"). */
  titleSlot?: ComponentChildren;
}

// ── Preact component ────────────────────────────────────────────────────────

/** The box a title's contents should measure themselves against. The title
 *  hugs its own content so the identity actions can sit against it, which makes
 *  it useless as a width budget: shrink it once and it stops tracking the pane,
 *  so a ResizeObserver watching it never hears the pane grow back. This group
 *  fills the row, so it does. */
export const PaneTitleBudgetContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function PaneHeader({
  title,
  mono,
  onFocus,
  focusTitle = 'Focus camera',
  copyText,
  copyLabel,
  openUrl,
  openLabel = 'Open on origin',
  actionsSlot,
  onClose,
  closeTitle = 'Hide sidebar',
  onExclude,
  excludeTitle,
  excludeDisabledReason,
  titleSlot,
}: PaneHeaderProps) {
  const leadRef = useRef<HTMLDivElement>(null);
  return (
    <div class="pane-header">
      <div class="pane-header-lead" ref={leadRef}>
        <h3 class={`text-pane-title${mono ? ' is-mono' : ''}`}>
          <PaneTitleBudgetContext.Provider value={leadRef}>
            {titleSlot ?? title}
          </PaneTitleBudgetContext.Provider>
        </h3>
        {(copyText != null || openUrl) && (
          <div class="pane-header-identity">
            {copyText != null && <CopyButton text={copyText} label={copyLabel} />}
            {openUrl && (
              <a
                class="btn-icon btn-icon--link"
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={openLabel}
                aria-label={openLabel}
              >
                <ExternalLink class="icon" />
              </a>
            )}
          </div>
        )}
      </div>
      <div class="pane-header-actions">
        {typeof onFocus === 'function' && (
          <button
            type="button"
            class="btn-icon"
            title={focusTitle}
            aria-label={focusTitle}
            onClick={(e) => {
              // Blur so a subsequent Space/Enter doesn't re-activate this button
              // (re-firing focus) — let those keystrokes fall through to the
              // document-level canvas keydown handler.
              (e.currentTarget as HTMLButtonElement).blur();
              onFocus();
            }}
          >
            <Focus class="icon" />
          </button>
        )}
        {actionsSlot ?? null}
        {typeof onExclude === 'function' && (
          <button
            type="button"
            class={`btn-icon${excludeDisabledReason ? ' btn-icon--inert' : ''}`}
            // The reason goes in the tooltip only: the accessible name has to
            // stay what the button does, or a screen reader announces the
            // objection and never the action it objects to.
            title={excludeDisabledReason ?? excludeTitle ?? 'Exclude from city'}
            aria-label={excludeTitle ?? 'Exclude from city'}
            // aria-disabled, not disabled: a disabled button drops its hover, and
            // the tooltip is the whole point of still drawing it (same trade as
            // SourceRow's unavailable rows).
            aria-disabled={excludeDisabledReason ? 'true' : undefined}
            onClick={excludeDisabledReason ? undefined : () => onExclude()}
          >
            <EyeOff class="icon" />
          </button>
        )}
        {typeof onClose === 'function' && <PaneCloseButton onClose={onClose} title={closeTitle} />}
      </div>
    </div>
  );
}

// ── Close button ────────────────────────────────────────────────────────────

export interface PaneCloseButtonProps {
  onClose: () => void;
  /** Tooltip / aria-label. Defaults to "Hide sidebar". */
  title?: string;
}

/** The pane's close button. Shared by the default header and by panes that
 *  compose their own header (e.g. InfoPane's tab strip). Plain .btn-icon so it
 *  matches the icon-only buttons in the app header.
 *
 *  It puts a panel away rather than closing anything — a right-sidebar pane
 *  keeps its selection — so it draws the panel collapsing toward its own edge.
 *  An × would promise the thing is gone. Outside a sidebar there's no edge to
 *  collapse toward, and × is right again. */
export function PaneCloseButton({ onClose, title = 'Hide sidebar' }: PaneCloseButtonProps) {
  const side = useContext(SidebarSideContext);
  const Icon =
    side === SidebarSide.Right ? PanelRightClose : side === SidebarSide.Left ? PanelLeftClose : X;
  return (
    <button
      type="button"
      class="btn-icon"
      title={title}
      aria-label={title}
      onClick={() => onClose()}
    >
      <Icon class="icon" />
    </button>
  );
}

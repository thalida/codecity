// components/Pane.tsx — the chrome every sidebar pane wears: the wrapper, the
// header, and the scrolling body when one is asked for. PaneEmpty is the shared
// "nothing to show" block.

import type { ComponentChildren, JSX, Ref } from 'preact';
import type { LucideIcon } from 'lucide-preact';
import { PaneHeader } from './PaneHeader/PaneHeader';

export interface PaneProps {
  /** Extra class on the outer `.pane` (e.g. 'commit-pane', 'explore-pane'). */
  paneClass?: string;
  /** Replaces the header outright, for a pane whose tab strip is its header.
   *  The title and action props are ignored when it's set. */
  headerSlot?: ComponentChildren;
  /** Plain-text header title. */
  title?: string;
  /** Rich header title content; overrides `title` when set. */
  titleSlot?: ComponentChildren;
  /** Render the title in monospace (filename / path identifier panes). */
  mono?: boolean;
  /** fn() for the header focus button. Omit to render no button. */
  onFocus?: () => void;
  focusTitle?: string;
  /** Text the header copy button copies (a path, a SHA). Omit for no copy button. */
  copyText?: string;
  copyLabel?: string;
  /** Open-on-origin URL (commit/file/dir). Omit for no open link. */
  openUrl?: string | null;
  openLabel?: string;
  /** Extra header action buttons (e.g. commit view-on-timeline). */
  actionsSlot?: ComponentChildren;
  /** fn() for the header × button. Omit to render no button. */
  onClose?: () => void;
  closeTitle?: string;
  /** fn() for the header "exclude from city" button. Omit to render no button. */
  onExclude?: () => void;
  excludeTitle?: string;
  /** Why this node can't be excluded; see PaneHeader. */
  excludeDisabledReason?: string;
  /** When set (or when `bodyRef` is set), Pane renders a `.pane-body` wrapper
   *  with this extra class around `children`. Omit for custom body layout. */
  bodyClass?: string;
  /** Ref to the `.pane-body` element — for panes that mount body content
   *  imperatively (e.g. FilePreviewPane's highlight.js output). */
  bodyRef?: Ref<HTMLDivElement>;
  /** Extra attributes spread onto the `.pane-body` (e.g. tabpanel role/id for a
   *  tabbed pane whose body is the panel). Only applies when Pane owns the body. */
  bodyProps?: JSX.HTMLAttributes<HTMLDivElement>;
  /** Content rendered AFTER the body (e.g. ControlsPane's sticky action bar),
   *  outside the scrolling body region. */
  footerSlot?: ComponentChildren;
  /** Ref to the outer `.pane` element — for panes that need to query their own
   *  DOM. */
  paneRef?: Ref<HTMLDivElement>;
  children?: ComponentChildren;
}

export function Pane({
  paneClass,
  headerSlot,
  title,
  titleSlot,
  mono,
  onFocus,
  focusTitle,
  copyText,
  copyLabel,
  openUrl,
  openLabel,
  actionsSlot,
  onClose,
  closeTitle,
  onExclude,
  excludeTitle,
  excludeDisabledReason,
  bodyClass,
  bodyRef,
  bodyProps,
  footerSlot,
  paneRef,
  children,
}: PaneProps) {
  const ownsBody = bodyClass !== undefined || bodyRef !== undefined;
  return (
    <div class={paneClass ? `pane ${paneClass}` : 'pane'} ref={paneRef}>
      {headerSlot ?? (
        <PaneHeader
          title={title ?? ''}
          titleSlot={titleSlot}
          mono={mono}
          onFocus={onFocus}
          focusTitle={focusTitle}
          copyText={copyText}
          copyLabel={copyLabel}
          openUrl={openUrl}
          openLabel={openLabel}
          actionsSlot={actionsSlot}
          onClose={onClose}
          closeTitle={closeTitle}
          onExclude={onExclude}
          excludeTitle={excludeTitle}
          excludeDisabledReason={excludeDisabledReason}
        />
      )}
      {ownsBody ? (
        <div
          class={bodyClass ? `pane-body ${bodyClass}` : 'pane-body'}
          ref={bodyRef}
          {...bodyProps}
        >
          {children}
        </div>
      ) : (
        children
      )}
      {footerSlot}
    </div>
  );
}

export interface PaneEmptyProps {
  /** Lucide glyph component (e.g. `FolderOpen` from lucide-preact); omit for
   *  a text-only empty state. */
  icon?: LucideIcon;
  title: string;
  sub?: string;
  /** Large variant (bigger icon) — the default for selection panes. */
  large?: boolean;
  /** Extra empty-state modifier class, e.g. empty-state--absent. */
  modifier?: string;
}

export function PaneEmpty({ icon: Icon, title, sub, large = true, modifier }: PaneEmptyProps) {
  const base = large ? 'empty-state empty-state--lg' : 'empty-state';
  return (
    <div class={modifier ? `${base} ${modifier}` : base}>
      {Icon && <Icon class="icon" />}
      <p class="text-card-title">{title}</p>
      {sub && <p class="text-card-sub">{sub}</p>}
    </div>
  );
}

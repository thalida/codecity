// components/Pane.tsx — Generic pane chrome shared by every
// sidebar pane (Tree, Search, Info, Controls on the left; File, Commit,
// Street on the right). Owns the outer `.pane` wrapper, the header (via
// <PaneHeader>), and — when given a `bodyClass`/`bodyRef` — the scrolling
// `.pane-body` container. Panes with non-standard body layout (e.g. the
// search input row above the results) omit `bodyClass` and supply their
// own body markup as children.
//
// <PaneEmpty> is the shared centered icon + headline + subtitle block used
// for every "nothing selected / nothing to show" empty state.

import type { ComponentChildren, JSX, Ref } from 'preact';
import type { LucideIcon } from 'lucide-preact';
import { PaneHeader } from './PaneHeader/PaneHeader';

export interface PaneProps {
  /** Extra class on the outer `.pane` (e.g. 'commit-pane', 'explore-pane'). */
  paneClass?: string;
  /** Replaces the entire default <PaneHeader> — for panes whose header isn't a
   *  title bar (e.g. a tabbed pane whose tab strip IS the header). When set,
   *  the title/focus/close header props are ignored. */
  headerSlot?: ComponentChildren;
  /** Plain-text header title. */
  title?: string;
  /** Rich header title content; overrides `title` when set. */
  titleSlot?: ComponentChildren;
  /** Render the title in monospace (filename / path identifier panes). */
  mono?: boolean;
  /** Element between the focus button and title (e.g. an extension badge). */
  prefixSlot?: ComponentChildren;
  /** fn() for the header focus button. Omit to render no button. */
  onFocus?: () => void;
  focusTitle?: string;
  /** fn() for the header × button. Omit to render no button. */
  onClose?: () => void;
  closeTitle?: string;
  /** fn() for the header "exclude from city" button. Omit to render no button. */
  onExclude?: () => void;
  excludeTitle?: string;
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
  prefixSlot,
  onFocus,
  focusTitle,
  onClose,
  closeTitle,
  onExclude,
  excludeTitle,
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
          prefixSlot={prefixSlot}
          onFocus={onFocus}
          focusTitle={focusTitle}
          onClose={onClose}
          closeTitle={closeTitle}
          onExclude={onExclude}
          excludeTitle={excludeTitle}
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
}

export function PaneEmpty({ icon: Icon, title, sub, large = true }: PaneEmptyProps) {
  return (
    <div class={large ? 'empty-state empty-state--lg' : 'empty-state'}>
      {Icon && <Icon class="icon" />}
      <p class="text-card-title">{title}</p>
      {sub && <p class="text-card-sub">{sub}</p>}
    </div>
  );
}

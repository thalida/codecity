// types/ui.ts — discriminants for the UI shell + panes.

/** Left-sidebar tab IDs. Discriminator on the activity bar's mounted pane. */
export enum SidebarTab {
  Tree = 'tree',
  Search = 'search',
  Info = 'info',
  Controls = 'controls',
}

/**
 * Where a file's date metadata came from. Footer + preview show this as
 * a parenthesized source tag next to the date, so users can tell whether
 * the date is from git history or filesystem stat.
 */
export enum DateSource {
  Git = 'git',
  Filesystem = 'fs',
}

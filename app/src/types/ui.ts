// types/ui.ts — discriminants for the UI shell + panes.

/** Left-sidebar tab IDs. Discriminator on the activity bar's mounted pane. */
export enum SidebarTab {
  Tree = 'tree',
  Search = 'search',
  Info = 'info',
  Controls = 'controls',
}

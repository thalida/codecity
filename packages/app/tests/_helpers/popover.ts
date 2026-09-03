// Popover panels render through a portal on <body>, so they are not inside the
// container a test renders its component into: query the open panel itself,
// and root anything inside it there.

export const popoverPanel = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[role="dialog"]');

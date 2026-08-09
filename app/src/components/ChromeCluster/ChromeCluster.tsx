// components/ChromeCluster/ChromeCluster.tsx — related controls in the
// header/footer bars, outlined as one object with dividers between them. The
// border says "these belong together", the divider says "these are separate
// presses".
//
// Every item goes through <ClusterItem>, which is the project chip's box: 24px
// tall, auto width, symmetric inline padding. Callers pass what goes INSIDE the
// item, not a pre-built button, so nothing in a cluster can arrive with its own
// height, its own padding or its own border to fight.

import './ChromeCluster.css';
import type { ComponentChildren, JSX } from 'preact';

/** The item box. A control that can appear in a bar takes this instead of its
 *  own .btn-* box, so nothing inside a cluster brings a competing height,
 *  padding or radius. */
export const CLUSTER_ITEM = 'cluster-item';
export const CLUSTER_ITEM_PRESS = 'cluster-item cluster-item--press';

export interface ChromeClusterProps {
  children: ComponentChildren;
  class?: string;
}

export function ChromeCluster({ children, class: className }: ChromeClusterProps) {
  return <div class={className ? `chrome-cluster ${className}` : 'chrome-cluster'}>{children}</div>;
}

type ItemProps<E extends EventTarget> = {
  children: ComponentChildren;
  class?: string;
} & Omit<JSX.HTMLAttributes<E>, 'class' | 'children'>;

/** A pressable item. */
export function ClusterButton({
  children,
  class: className,
  ...rest
}: ItemProps<HTMLButtonElement>) {
  return (
    <button type="button" class={`${CLUSTER_ITEM_PRESS} ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
}

/** A link that looks and sits like a pressable item. */
export function ClusterLink({
  children,
  class: className,
  ...rest
}: ItemProps<HTMLAnchorElement> & JSX.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a class={`${CLUSTER_ITEM_PRESS} ${className ?? ''}`} {...rest}>
      {children}
    </a>
  );
}

/** A read-only item: a label or readout, with no press affordance. */
export function ClusterText({ children, class: className, ...rest }: ItemProps<HTMLSpanElement>) {
  return (
    <span class={`${CLUSTER_ITEM} ${className ?? ''}`} {...rest}>
      {children}
    </span>
  );
}

// components/ChromeCluster/ChromeCluster.tsx — related controls in the
// header/footer bars, outlined as one object with dividers between them. The
// border says "these belong together", the divider says "these are separate
// presses". Every item wears CLUSTER_ITEM, the project chip's box.

import './ChromeCluster.css';
import type { ComponentChildren, JSX } from 'preact';

export const CLUSTER_ITEM = 'cluster-item';
/** The item box plus the accent that marks it pressable. */
export const CLUSTER_ITEM_PRESS = `${CLUSTER_ITEM} cluster-item--press`;

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

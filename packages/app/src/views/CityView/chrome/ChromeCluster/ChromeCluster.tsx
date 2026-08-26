// views/CityView/chrome/ChromeCluster/ChromeCluster.tsx — related controls in a header/footer bar, outlined
// as one object with dividers between them: the border says "these belong
// together", the divider "these are separate presses". It styles its own
// children, so nothing it wraps knows it is in a cluster.

import './ChromeCluster.css';
import type { ComponentChildren } from 'preact';

export interface ChromeClusterProps {
  children: ComponentChildren;
  class?: string;
}

export function ChromeCluster({ children, class: className }: ChromeClusterProps) {
  return <div class={className ? `chrome-cluster ${className}` : 'chrome-cluster'}>{children}</div>;
}

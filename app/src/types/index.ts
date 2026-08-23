// types/index.ts — barrel re-export. Lets callers do
//   import { NodeKind, FileNode, Building } from '@/types';
// without remembering which subfile owns what.

export * from './manifest';
export * from './timeline';
export * from './building';
export * from './street';
export * from './scene';
export * from './animation';
export * from './ui';

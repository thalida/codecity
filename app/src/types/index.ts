// types/index.ts — barrel re-export. Lets callers do
//   import { NodeKind, FileNode } from '@/types';
import { Building } from '@/city/scene/types';
// without remembering which subfile owns what.

export * from './manifest';
export * from './timeline';
export * from './ui';

// Shape of the scanner's output. Derived from the OpenAPI schemas via
// `just gen-types`, so a backend field lands here with no edit.

import type { components } from './manifest.generated';

type Schemas = components['schemas'];

/**
 * Single shared discriminator across scene + selection state. Widens the
 * wire's 'file' | 'directory' with scene-only kinds (the renderer's
 * mesh.userData.type uses the same union), which is why FileNode and DirNode
 * re-declare `type` instead of aliasing the schema outright.
 */
export enum NodeKind {
  File = 'file',
  Directory = 'directory',
  Gem = 'gem',
  Label = 'label',
  Commit = 'commit',
}

export type FileNode = Omit<Schemas['FileNode'], 'type'> & { type: NodeKind.File };

export type DirNode = Omit<Schemas['DirNode'], 'type' | 'children'> & {
  type: NodeKind.Directory;
  children: TreeNode[];
};

export type TreeNode = FileNode | DirNode;

export type ExtBreakdownEntry = Schemas['ExtBreakdownEntry'];
export type RepoInfo = Schemas['RepoInfo'];
export type CommitEntry = Schemas['CommitEntry'];
export type BusynessThresholds = Schemas['BusynessThresholds'];
export type DateRanges = Schemas['DateRanges'];
export type RangeStat = Schemas['RangeStat'];
export type FileLeader = Schemas['FileLeader'];
export type DirLeader = Schemas['DirLeader'];
export type CommitLeader = Schemas['CommitLeader'];
export type CommitDateRange = Schemas['CommitDateRange'];
export type DayLeader = Schemas['DayLeader'];
export type AuthorStat = Schemas['AuthorStat'];
export type RepoStats = Schemas['RepoStats'];

/**
 * The three signature fields form a ladder, each a superset of the last:
 * structure_signature (paths + nesting) drives icon-atlas assignment;
 * layout_signature adds per-file size and gates layout reuse; content_signature
 * adds mtime, dirty and repo HEAD, and is the live-poll + cache key.
 */
export type Manifest = Omit<Schemas['Manifest'], 'tree'> & { tree: DirNode };

/** Project-wide normalization ranges for building size. Frontend-only. */
export interface FileStats {
  lines: RangeStat;
  bytes: RangeStat;
}

// Shape of the scanner's output. Derived from the OpenAPI schemas via
// `just gen-types`, so a backend field lands here with no edit.

import type { components } from './manifest.generated';

type Schemas = components['schemas'];

/** Scene + selection discriminator: the wire's 'file' | 'directory' widened with
 *  scene-only kinds, so FileNode/DirNode re-declare `type` rather than alias it. */
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
export type DayLeader = Schemas['DayLeader'];
export type AuthorStat = Schemas['AuthorStat'];
export type RepoStats = Schemas['RepoStats'];

/** Three signatures, a ladder: structure (paths + nesting) assigns the icon
 *  atlas, layout adds sizes, content adds mtime/dirty/HEAD and keys the poll. */
export type Manifest = Omit<Schemas['Manifest'], 'tree'> & { tree: DirNode };

/** Which repo a path belongs to. Every path on the wire is repo-relative, so a
 *  read pairs one with the source its manifest was built for. */
export type SourceRef = Pick<Schemas['Manifest'], 'src' | 'branch'>;

/** Project-wide normalization ranges for building size. Frontend-only. */
export interface FileStats {
  lines: RangeStat;
  bytes: RangeStat;
}

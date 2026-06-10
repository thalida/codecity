// Compile-time drift guard. The hand-written wire types in ./manifest must
// stay in sync with the OpenAPI-generated schemas in ./manifest.generated
// (single source of truth: api/models/*.py). `tsc --noEmit` (npm run
// typecheck) FAILS on drift. Regenerate after any wire-model change with
// `just gen-types`.
//
// Two tiers:
//   • Pure-scalar types (no NodeKind discriminator, no recursion) are compared
//     by DEEP type equality — catching field add/remove/rename AND type /
//     optionality / nullability drift.
//   • NodeKind-discriminated / recursive types (Manifest/FileNode/DirNode) are
//     compared by KEY SET only: the frontend's NodeKind enum intentionally
//     extends the wire's string-literal discriminator (file/directory + the
//     scene-only gem/label/commit), so a deep equality would flag the `type`
//     field by design. Key-set drift is the real risk there.
import type { components } from './manifest.generated';
import type {
  Manifest,
  FileNode,
  DirNode,
  GitMeta,
  RepoInfo,
  CommitEntry,
  ExtBreakdownEntry,
  BusynessThresholds,
} from './manifest';

type Schemas = components['schemas'];

// True iff A and B are the exact same type.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// Compiles only when the assertion holds; `tsc` errors otherwise.
type AssertTrue<T extends true> = T;

// Deep equality — pure-scalar wire types (full type/optionality/nullability).
type _GitMeta = AssertTrue<Equals<GitMeta, Schemas['GitMeta']>>;
type _RepoInfo = AssertTrue<Equals<RepoInfo, Schemas['RepoInfo']>>;
type _CommitEntry = AssertTrue<Equals<CommitEntry, Schemas['CommitEntry']>>;
type _ExtBreakdown = AssertTrue<Equals<ExtBreakdownEntry, Schemas['ExtBreakdownEntry']>>;
type _Busyness = AssertTrue<Equals<BusynessThresholds, Schemas['BusynessThresholds']>>;

// Key-set equality — NodeKind-discriminated / recursive types.
type _Manifest = AssertTrue<Equals<keyof Manifest, keyof Schemas['Manifest']>>;
type _FileNode = AssertTrue<Equals<keyof FileNode, keyof Schemas['FileNode']>>;
type _DirNode = AssertTrue<Equals<keyof DirNode, keyof Schemas['DirNode']>>;

// Compile-time drift guard. The hand-written wire types in ./manifest must
// keep the SAME FIELD SET as the OpenAPI-generated schemas in
// ./manifest.generated (single source of truth: api/models/*.py). `tsc
// --noEmit` (npm run typecheck) FAILS if a wire field is added, removed, or
// renamed on either side.
//
// We compare KEY SETS, not deep types: the frontend's NodeKind enum
// intentionally extends the wire's string-literal discriminator (file/
// directory + scene-only gem/label/commit), and a few BaseModel-vs-TypedDict
// nullable/optional nuances differ harmlessly — so a deep type-equality would
// produce false positives. Field-set drift is the real risk and is what this
// catches. Regenerate after any wire-model change with `just gen-types`.
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

// True iff A and B are the exact same type (used here on `keyof` unions).
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// Compiles only when the assertion holds; `tsc` errors otherwise.
type AssertTrue<T extends true> = T;

type _Manifest = AssertTrue<Equals<keyof Manifest, keyof Schemas['Manifest']>>;
type _FileNode = AssertTrue<Equals<keyof FileNode, keyof Schemas['FileNode']>>;
type _DirNode = AssertTrue<Equals<keyof DirNode, keyof Schemas['DirNode']>>;
type _GitMeta = AssertTrue<Equals<keyof GitMeta, keyof Schemas['GitMeta']>>;
type _RepoInfo = AssertTrue<Equals<keyof RepoInfo, keyof Schemas['RepoInfo']>>;
type _CommitEntry = AssertTrue<Equals<keyof CommitEntry, keyof Schemas['CommitEntry']>>;
type _ExtBreakdown = AssertTrue<
  Equals<keyof ExtBreakdownEntry, keyof Schemas['ExtBreakdownEntry']>
>;
type _Busyness = AssertTrue<Equals<keyof BusynessThresholds, keyof Schemas['BusynessThresholds']>>;

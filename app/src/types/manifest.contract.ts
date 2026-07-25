// Wire types are derived from ./manifest.generated, so field drift can't happen.
// The one thing a derived type can't check: our NodeKind still matches the wire.
import type { components } from './manifest.generated';
import { NodeKind } from './manifest';

type Schemas = components['schemas'];

type AssertTrue<T extends true> = T;

// Assignability, not identity: a string-enum member is its own type in TS, never
// identical to the bare literal. What matters is that ours is a legal wire value.
type _FileKind = AssertTrue<NodeKind.File extends Schemas['FileNode']['type'] ? true : false>;
type _DirKind = AssertTrue<NodeKind.Directory extends Schemas['DirNode']['type'] ? true : false>;

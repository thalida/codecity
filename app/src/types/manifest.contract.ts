// Wire types are derived from ./manifest.generated, so field drift can't happen.
// What a derived type can't check: our hand-written enums still match the wire.
import type { components } from './manifest.generated';
import { NodeKind } from './manifest';
import { ScanPhase, CloneStage } from '@/api/manifest';
import { TimelineStage } from './timeline';

type Schemas = components['schemas'];

type AssertTrue<T extends true> = T;

// Assignability, not identity: a string-enum member is its own type in TS, never
// identical to the bare literal. What matters is that ours is a legal wire value.
type _FileKind = AssertTrue<NodeKind.File extends Schemas['FileNode']['type'] ? true : false>;
type _DirKind = AssertTrue<NodeKind.Directory extends Schemas['DirNode']['type'] ? true : false>;

// Both directions: TimelineProgress substitutes this enum for the wire union, so
// a stage added on either side has to be added on the other.
type _StageToWire = AssertTrue<`${TimelineStage}` extends Schemas['TimelineStage'] ? true : false>;
type _WireToStage = AssertTrue<Schemas['TimelineStage'] extends `${TimelineStage}` ? true : false>;

// ScanPhase mirrors the SSE event NAMES: a renamed one would typecheck here
// and then simply never match, stalling the overlay rather than failing.
type _PhaseToWire = AssertTrue<`${ScanPhase}` extends Schemas['ScanEvent'] ? true : false>;
type _WireToPhase = AssertTrue<Schemas['ScanEvent'] extends `${ScanPhase}` ? true : false>;

// Both directions, as above: git's progress labels are parsed on the server and
// switched on here.
type _CloneToWire = AssertTrue<`${CloneStage}` extends Schemas['CloneStage'] ? true : false>;
type _WireToClone = AssertTrue<Schemas['CloneStage'] extends `${CloneStage}` ? true : false>;

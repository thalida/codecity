// components/sources/UnreachableSource/UnreachableSource.tsx — why a source
// cannot be read here. Never claims the repo is private (GitHub 404s private and
// typo alike to an anonymous caller) or says "you don't have access", which
// blames the user for a property of this server.
import './UnreachableSource.css';
import { useState } from 'preact/hooks';
import { ChevronDown } from 'lucide-preact';
import { CopyButton } from '@/components/buttons/CopyButton/CopyButton';
import { SetupGuideLink } from '@/components/app/SetupGuideLink/SetupGuideLink';

/** What failed. The resting state is not here: the landing's own band says what
 *  this instance can open, so this component only ever answers a failure. */
export enum NoticeReason {
  /** A repo was pasted and the server couldn't reach it. */
  Unreachable = 'unreachable',
  /** A local path was typed where local paths are off. */
  PathBlocked = 'path-blocked',
}

export interface UnreachableSourceProps {
  /** This instance can read local paths, which is the only thing that changes
   *  the remedy: with it, a folder you already have is openable. */
  allowLocal: boolean;
  reason: NoticeReason;
  /** The source that failed, used for the `git clone` line. */
  src?: string;
  /** So a field can point aria-describedby at it when the notice IS the
   *  field's error. */
  id?: string;
}

// `-e` plus a matching `-v` IS turning local paths on, which is why this is the
// one answer for a visitor and an unmounted local instance alike.
const RUN_COMMAND = `docker run --rm --init --pull=always \\
    -e CODECITY_ALLOW_LOCAL_REPOS=1 \\
    -v "$HOME/Repos:$HOME/Repos:ro" \\
    -v codecity-cache:/cache \\
    -p 8080:8080 \\
    ghcr.io/thalida/codecity`;

const PREAMBLE: Record<NoticeReason, string> = {
  [NoticeReason.Unreachable]: "Couldn't reach that repo.",
  [NoticeReason.PathBlocked]: "codecity can't open that path.",
};

// The rule, not an instruction: nothing on this screen can mount anything, so an
// imperative here would be an affordance the notice does not have.
const REMEDY: Record<NoticeReason, string> = {
  [NoticeReason.Unreachable]: "If it's private, clone it yourself and open the folder.",
  [NoticeReason.PathBlocked]: 'Local folders have to be mounted when codecity starts.',
};

export function UnreachableSource({ allowLocal, reason, src, id }: UnreachableSourceProps) {
  return (
    <div id={id} class="unreachable" role="alert">
      <p class="unreachable-remedy">
        <strong class="unreachable-preamble">{PREAMBLE[reason]}</strong> {REMEDY[reason]}
      </p>
      <Remedy allowLocal={allowLocal} src={src} />
    </div>
  );
}

/** One boolean: either this instance can open a folder you already have, or you
 *  need one that can. Both hand over the command, never just a link. */
function Remedy({ allowLocal, src }: Pick<UnreachableSourceProps, 'allowLocal' | 'src'>) {
  if (allowLocal) {
    return (
      <>
        <CloneCommand src={src} />
        <p class="unreachable-actions">
          <SetupGuideLink />
        </p>
      </>
    );
  }
  return <RunItYourself src={src} />;
}

/** Both steps, behind one disclosure: collapsed it is a control, open it is the
 *  whole answer rather than a link to go and find it. */
function RunItYourself({ src }: { src?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div class="unreachable-actions">
        <button
          type="button"
          class="unreachable-disclose"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Run it yourself
          <ChevronDown class={`icon unreachable-chevron${open ? ' is-open' : ''}`} />
        </button>
        <SetupGuideLink />
      </div>
      {open && (
        <div class="unreachable-detail">
          <CloneCommand src={src} />
          <div class="unreachable-command unreachable-command--block">
            <pre>{RUN_COMMAND}</pre>
            <CopyButton text={RUN_COMMAND} label="Copy run command" />
          </div>
          <p class="unreachable-hint">
            Point <code>-v</code> at the folder your repos live in, then open localhost:8080.
          </p>
        </div>
      )}
    </>
  );
}

function CloneCommand({ src }: { src?: string }) {
  if (!src) return null;
  const command = `git clone ${src}`;
  return (
    <div class="unreachable-command">
      <code>{command}</code>
      <CopyButton text={command} label="Copy clone command" />
    </div>
  );
}

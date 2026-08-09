// components/UnreachableSource/UnreachableSource.tsx — what to do when a repo
// can't be opened. One component, three remedies, two triggers.
//
// The remedy is a function of the SERVER, not of what went wrong. The trigger
// only decides whether a preamble sits in front of it.
//
//   hosted                 -> run codecity on your own machine
//   !hosted && allowLocal  -> clone it and open the folder
//   !hosted && !allowLocal -> enable local paths
//
// hosted is checked FIRST, and beats a mount. A hosted instance can have local
// repos enabled for its own filesystem, but the visitor is on a different
// machine: telling them to clone and "open the folder" points at a folder only
// the server could ever see.
//
// Two things this must never say. It must not assert the repo is private:
// GitHub returns 404 to an unauthenticated caller whether the repo is private
// or the URL is a typo, so the two are indistinguishable from here. And it must
// not say "you do not have access", which blames the user for a property of
// this server.

import './UnreachableSource.css';
import { Info, AlertCircle } from 'lucide-preact';
import { CopyButton } from '@/components/CopyButton/CopyButton';
import { REPO_URL } from '@/constants/ui';

export interface UnreachableSourceProps {
  /** This is the public deployment, where a local path can never resolve. */
  hosted: boolean;
  /** This instance can read local paths. */
  allowLocal: boolean;
  /** `standing` sits under the field as guidance; `error` answers a load that
   *  already failed, and adds the preamble. Never changes the remedy. */
  variant: 'standing' | 'error';
  /** The source that failed, used for the `git clone` line. */
  src?: string;
  /** So a field can point aria-describedby at it when the notice IS the
   *  field's error. */
  id?: string;
}

const LOCAL_DOCS_URL = `${REPO_URL}#local-directories`;
const RUN_DOCS_URL = `${REPO_URL}#run-it-yourself`;

export function UnreachableSource({
  hosted,
  allowLocal,
  variant,
  src,
  id,
}: UnreachableSourceProps) {
  const cloneCommand = src ? `git clone ${src}` : null;
  const Glyph = variant === 'error' ? AlertCircle : Info;

  return (
    <div
      id={id}
      class={`unreachable unreachable--${variant}`}
      role={variant === 'error' ? 'alert' : undefined}
    >
      <Glyph class="icon unreachable-glyph" aria-hidden="true" />
      <div class="unreachable-body">
        {variant === 'error' && <p class="unreachable-preamble">Couldn't reach that repo.</p>}

        {hosted ? (
          <p class="unreachable-remedy">
            Private and local repos need codecity running on your own machine.{' '}
            <a class="link--chrome" href={RUN_DOCS_URL} target="_blank" rel="noopener noreferrer">
              See&nbsp;docs
            </a>
          </p>
        ) : allowLocal ? (
          <>
            <p class="unreachable-remedy">
              If it's private, clone it yourself and open the folder instead.
            </p>
            {/* Only in this column: on a hosted instance the folder would be one
              only the server can see, and on an unmounted local one it's half a
              fix. */}
            {cloneCommand && (
              <div class="unreachable-command">
                <code>{cloneCommand}</code>
                <CopyButton text={cloneCommand} label="Copy clone command" />
              </div>
            )}
          </>
        ) : (
          <p class="unreachable-remedy">
            Local paths aren't enabled.{' '}
            <a class="link--chrome" href={LOCAL_DOCS_URL} target="_blank" rel="noopener noreferrer">
              See&nbsp;docs
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

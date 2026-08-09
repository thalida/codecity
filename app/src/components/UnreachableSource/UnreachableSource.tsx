// components/UnreachableSource/UnreachableSource.tsx — what to do when a repo
// can't be opened. One component, three remedies, two triggers.
//
// The remedy is a function of the SERVER, not of what went wrong: what you can
// do about an unreachable repo depends on whether this instance can read local
// paths at all, and whether that's fixable. The trigger only decides whether a
// preamble sits in front of it.
//
//   allowLocal              -> clone it and open the folder
//   !allowLocal && hosted   -> run codecity on your machine
//   !allowLocal && !hosted  -> enable local paths
//
// Two things this must never say. It must not assert the repo is private:
// GitHub returns 404 to an unauthenticated caller whether the repo is private
// or the URL is a typo, so the two are indistinguishable from here. And it must
// not say "you do not have access", which blames the user for a property of
// this server.

import './UnreachableSource.css';
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
}

const LOCAL_DOCS_URL = `${REPO_URL}#local-directories`;
const RUN_DOCS_URL = `${REPO_URL}#run-it-yourself`;

export function UnreachableSource({ hosted, allowLocal, variant, src }: UnreachableSourceProps) {
  const cloneCommand = src ? `git clone ${src}` : null;

  return (
    <div
      class={`unreachable unreachable--${variant}`}
      role={variant === 'error' ? 'alert' : undefined}
    >
      {variant === 'error' && <p class="unreachable-preamble">Couldn't reach that repo.</p>}

      {allowLocal ? (
        <>
          <p class="unreachable-remedy">
            If it's private, clone it yourself and open the folder instead.
          </p>
          {/* Only in this column: on a hosted instance this would tell you to do
              something the app then can't help with, and on an unmounted local
              one it's half a fix. */}
          {cloneCommand && (
            <div class="unreachable-command">
              <code>{cloneCommand}</code>
              <CopyButton text={cloneCommand} label="Copy clone command" />
            </div>
          )}
        </>
      ) : hosted ? (
        <>
          <p class="unreachable-remedy">
            Private and local repos need codecity running on your own machine.
          </p>
          <a
            class="unreachable-link link--chrome"
            href={RUN_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            How to run it
          </a>
        </>
      ) : (
        <>
          <p class="unreachable-remedy">Local paths aren't enabled.</p>
          <a
            class="unreachable-link link--chrome"
            href={LOCAL_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            How to enable
          </a>
        </>
      )}
    </div>
  );
}

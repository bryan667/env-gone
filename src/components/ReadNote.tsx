import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DESTROYED_WARNING, UNAVAILABLE_MESSAGE } from '../../shared/protocol';
import { ApiError, consumeNote } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { decryptNote } from '../lib/crypto';
import { isValidNoteId, parseFragment, stripFragment, type LinkSecrets } from '../lib/link';
import { SiteFooter, SiteHeader } from './Chrome';

type Phase = 'incomplete' | 'confirm' | 'consuming' | 'revealed' | 'unavailable' | 'error';

/** A failure that may or may not have consumed the note. Retrying is allowed. */
const NETWORK_ERROR_MESSAGE =
  'The note could not be retrieved. A network or server problem stopped the request, so the ' +
  'note may already have been destroyed. It cannot be fetched again if it was.';

/** The server returned ciphertext, so the row is already gone. */
const DESTROYED_ERROR_MESSAGE =
  'The note was destroyed on the server, but its contents could not be decrypted, so it cannot ' +
  'be shown or fetched again.';

interface ReaderState {
  secrets: LinkSecrets | null;
  phase: Phase;
}

function readHashSecrets(id: string): LinkSecrets | null {
  if (!isValidNoteId(id) || typeof window === 'undefined') {
    return null;
  }
  return parseFragment(window.location.hash);
}

export function ReadNote({ id }: { id: string }) {
  const [reader, setReader] = useState<ReaderState>(() => {
    const secrets = readHashSecrets(id);
    return { secrets, phase: secrets === null ? 'incomplete' : 'confirm' };
  });
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [copied, setCopied] = useState(false);

  // Every accepted link gets a new generation. An in-flight consume whose
  // generation no longer matches is abandoned instead of overwriting newer state.
  const generationRef = useRef(0);
  // Guards against duplicate consume requests from rapid clicks, synchronously.
  const consumingRef = useRef(false);
  const acceptLink = useCallback((secrets: LinkSecrets | null) => {
    generationRef.current += 1;
    consumingRef.current = false;
    setReader({ secrets, phase: secrets === null ? 'incomplete' : 'confirm' });
    setPlaintext(null);
    setMessage(null);
    setCanRetry(false);
    setCopied(false);
  }, []);

  // Parse the fragment on load, and on every same-document hash change. Reopening
  // the original full URL in the same tab after it was stripped is a
  // fragment-only navigation, so the component is not remounted; this keeps it
  // correct without ever consuming a note. The fragment is removed again after
  // it has been read into memory.
  useEffect(() => {
    stripFragment();
    const onHashChange = () => {
      // A queued event may arrive after an earlier event already stripped it.
      if (window.location.hash.length === 0) return;
      acceptLink(readHashSecrets(id));
      stripFragment();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [id, acceptLink]);

  // Invalidate pending responses and clear secrets before this document can
  // enter the back/forward cache. Returning requires the original full link.
  useEffect(() => {
    const clearReader = () => {
      generationRef.current += 1;
      consumingRef.current = false;
      flushSync(() => {
        setPlaintext(null);
        setReader({ secrets: null, phase: 'incomplete' });
        setMessage(null);
        setCanRetry(false);
        setCopied(false);
      });
    };
    window.addEventListener('pagehide', clearReader);
    return () => {
      generationRef.current += 1;
      window.removeEventListener('pagehide', clearReader);
    };
  }, []);

  async function consume() {
    const { secrets } = reader;
    if (secrets === null || consumingRef.current) {
      return;
    }
    const generation = generationRef.current;
    consumingRef.current = true;
    setReader((previous) => ({ ...previous, phase: 'consuming' }));
    setMessage(null);
    setCanRetry(false);

    let payload;
    try {
      payload = await consumeNote(id, secrets.token);
    } catch (error) {
      if (generationRef.current !== generation) {
        return; // A different link took over; drop this stale response.
      }
      consumingRef.current = false;
      if (error instanceof ApiError && error.status === 410) {
        setReader({ secrets: null, phase: 'unavailable' });
      } else {
        setMessage(NETWORK_ERROR_MESSAGE);
        setCanRetry(true);
        setReader((previous) => ({ ...previous, phase: 'error' }));
      }
      return;
    }

    let text: string;
    try {
      text = await decryptNote(secrets.key, id, payload.iv, payload.ciphertext);
    } catch {
      if (generationRef.current !== generation) {
        return;
      }
      consumingRef.current = false;
      // Ciphertext came back, so the row is deleted and the note is destroyed
      // even though it cannot be displayed. Say so plainly; do not offer a retry.
      setMessage(DESTROYED_ERROR_MESSAGE);
      setCanRetry(false);
      setReader({ secrets: null, phase: 'error' });
      return;
    }

    if (generationRef.current !== generation) {
      return;
    }
    consumingRef.current = false;
    setPlaintext(text);
    setReader({ secrets: null, phase: 'revealed' });
  }

  async function handleCopyNote() {
    if (plaintext === null) {
      return;
    }
    const ok = await copyText(plaintext);
    setCopied(ok);
    if (ok) {
      window.setTimeout(() => setCopied(false), 2500);
    }
  }

  const headerAction = (
    <a className="head-link" href="/">
      Share variables
    </a>
  );

  const footerRight =
    reader.phase === 'revealed'
      ? 'The original link can no longer be used.'
      : reader.phase === 'unavailable' || (reader.phase === 'error' && !canRetry)
        ? 'This link cannot read the note again.'
        : reader.phase === 'error'
          ? 'The note may already have been destroyed.'
          : 'The note is retrieved only when you choose to reveal it.';

  return (
    <div className="shell">
      <SiteHeader action={headerAction} />
      <main className="main short">
        {reader.phase === 'revealed' && plaintext !== null ? (
          <>
            <p className="eyebrow">One-time env share</p>
            <h1 className="compact-h">Your environment variables.</h1>
            <div className="notice" role="status">
              {DESTROYED_WARNING}
            </div>
            <div className="note-head">
              <b>.env contents</b>
              <button className="button ghost tiny" type="button" onClick={handleCopyNote}>
                {copied ? 'Copied' : 'Copy variables'}
              </button>
            </div>
            <pre className="note-paper" aria-label="Environment variables">
              {plaintext}
            </pre>
            <div className="reveal-foot">
              <span className="small-line" aria-live="polite">
                {copied ? 'Variables copied to your clipboard.' : 'Only this open tab can still display this shared copy.'}
              </span>
              <a className="quiet-link" href="/">
                Share more variables →
              </a>
            </div>
          </>
        ) : (
          <div className="card center-card">
            {reader.phase === 'incomplete' ? (
              <>
                <p className="eyebrow">One-time env share</p>
                <h1>This link is incomplete.</h1>
                <p className="lede">
                  Reopen the full link from the message you received. It contains the key needed
                  to read the shared variables. Reloading this page cannot restore that key.
                </p>
              </>
            ) : reader.phase === 'unavailable' ? (
              <>
                <p className="eyebrow">One-time env share</p>
                <h1>This note is no longer available.</h1>
                <p className="lede" role="status">
                  {UNAVAILABLE_MESSAGE}
                </p>
              </>
            ) : reader.phase === 'error' ? (
              <>
                <p className="eyebrow">One-time env share</p>
                <h1>Something went wrong.</h1>
                <p className="lede" role="alert">
                  {message}
                </p>
                {canRetry ? (
                  <>
                    <div className="button-row">
                      <button className="button" type="button" onClick={() => void consume()}>
                        Try again
                      </button>
                    </div>
                    <p className="small-line">
                      Retrying will not create a second read. If the note was already destroyed, it
                      will show as unavailable.
                    </p>
                  </>
                ) : (
                  <div className="button-row">
                    <a className="button" href="/">
                      Share variables
                    </a>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="eyebrow">One-time env share</p>
                <h1>Read and destroy?</h1>
                <p className="lede">You’re about to reveal the shared variables and destroy the note with ID</p>
                <span className="id-pill">{id}</span>
                <div className="button-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => void consume()}
                    disabled={reader.phase === 'consuming'}
                  >
                    {reader.phase === 'consuming' ? 'Reading…' : 'Yes, show me the variables'}
                  </button>
                </div>
                <p className="small-line">This action cannot be undone.</p>
              </>
            )}
          </div>
        )}
      </main>
      <SiteFooter left="env-gone — environment variables, shared once." right={footerRight} />
    </div>
  );
}

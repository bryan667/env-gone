import { useMemo, useState } from 'react';
import {
  DEFAULT_TTL_SECONDS,
  MAX_PLAINTEXT_BYTES,
  TTL_OPTIONS,
  ttlLabel,
} from '../../shared/protocol';
import { ApiError, createNote } from '../lib/api';
import { copyText } from '../lib/clipboard';
import {
  encryptNote,
  newConsumeToken,
  newEncryptionKey,
  newNoteId,
  sha256Base64url,
} from '../lib/crypto';
import { buildShareLink } from '../lib/link';
import { SiteFooter, SiteHeader } from './Chrome';

type Phase = 'compose' | 'creating' | 'ready';

interface ReadyLink {
  url: string;
  ttlSeconds: number;
}

function describeCreateError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return 'The note was rejected by the server. Please check the contents and try again.';
      case 409:
        return 'That note ID already existed. Please try again.';
      case 413:
        return 'This note is too large to send.';
      case 503:
        return 'The service is temporarily unavailable. Your note has not been shared. Please try again.';
      default:
        return 'The note could not be created. Please try again.';
    }
  }
  return 'The note could not be created. Check your connection and try again.';
}

export function CreatePage() {
  const [note, setNote] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(DEFAULT_TTL_SECONDS);
  const [phase, setPhase] = useState<Phase>('compose');
  const [error, setError] = useState<string | null>(null);
  const [readyLink, setReadyLink] = useState<ReadyLink | null>(null);
  const [copied, setCopied] = useState(false);

  const byteLength = useMemo(() => new TextEncoder().encode(note).length, [note]);
  const overLimit = byteLength > MAX_PLAINTEXT_BYTES;

  async function handleCreate() {
    setError(null);
    if (note.length === 0) {
      setError('Paste the environment variables you want to share first.');
      return;
    }
    if (overLimit) {
      setError('This note is larger than the 64 KiB limit. Remove some content and try again.');
      return;
    }

    setPhase('creating');
    try {
      const id = newNoteId();
      const key = newEncryptionKey();
      const consumeToken = newConsumeToken();
      const { iv, ciphertext } = await encryptNote(key, id, note);
      const consumeTokenHash = await sha256Base64url(consumeToken);
      await createNote(
        { version: 1, id, iv, ciphertext, consumeTokenHash, ttlSeconds },
      );
      setReadyLink({ url: buildShareLink(window.location.origin, id, key, consumeToken), ttlSeconds });
      setNote('');
      setPhase('ready');
    } catch (createError) {
      setError(describeCreateError(createError));
      setPhase('compose');
    }
  }

  async function handleCopyLink() {
    if (readyLink === null) return;
    const ok = await copyText(readyLink.url);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  }

  function startAnother() {
    setReadyLink(null);
    setCopied(false);
    setError(null);
    setPhase('compose');
  }

  return (
    <div className="shell">
      <SiteHeader
        action={
          <a className="head-link" href="#how">
            How it works
          </a>
        }
      />
      <main className="main">
        {phase === 'ready' && readyLink !== null ? (
          <>
            <div className="status-mark" aria-hidden="true">✓</div>
            <p className="eyebrow">Ready to share</p>
            <h1 className="compact-h">Your .env link is ready.</h1>
            <p className="lede">
              Send this link to your teammate. They can reveal and copy the variables once.
              Unread shares expire in {ttlLabel(readyLink.ttlSeconds)}.
            </p>
            <div className="card">
              <div className="field-label">Private .env link</div>
              <div className="link-box">
                <input
                  className="link-input"
                  type="text"
                  readOnly
                  value={readyLink.url}
                  aria-label="One-time environment variables link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button className="button tiny" type="button" onClick={handleCopyLink}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p className="small-line" aria-live="polite">
                {copied ? 'Link copied to your clipboard.' : 'The decryption key is part of this link.'}
              </p>
              <p className="hint">
                Anyone with this link can read and destroy this shared copy. Leave the first read
                for your teammate.
              </p>
              <div className="card-foot">
                <span className="micro">Your variables were encrypted in your browser before they were sent.</span>
                <button className="button ghost" type="button" onClick={startAnother}>
                  Share more variables
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Environment variables, shared once</p>
            <h1>Share your .env.<br />Then it’s gone.</h1>
            <p className="lede">
              Send API keys, database URLs, and .env values to your teammates. Encrypted in your
              browser. The shared copy is deleted when revealed.
            </p>
            <form
              className="card"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreate();
              }}
              noValidate
            >
              <label className="field-label" htmlFor="note-input">
                <span>Environment variables</span>
                <span className="field-note">.env or plain text</span>
              </label>
              <textarea
                id="note-input"
                className={`note-input${overLimit ? ' is-invalid' : ''}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                placeholder={'# your-app / development\nDATABASE_URL=postgresql://user:password@localhost:5432/app\nAPI_KEY=replace-me\nAPP_ENV=development'}
                aria-describedby="byte-counter"
                disabled={phase === 'creating'}
              />
              <div className={`counter${overLimit ? ' is-invalid' : ''}`} id="byte-counter" aria-live="polite">
                {byteLength.toLocaleString()} bytes / 64 KiB
              </div>

              <div className="settings">
                <div className="field">
                  <label className="field-label" htmlFor="ttl-select">
                    Self-destructs after
                  </label>
                  <select
                    id="ttl-select"
                    className="input"
                    value={ttlSeconds}
                    onChange={(event) => setTtlSeconds(Number(event.target.value))}
                    disabled={phase === 'creating'}
                  >
                    {TTL_OPTIONS.map((option) => (
                      <option key={option.seconds} value={option.seconds}>
                        {option.label} (or first read)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error !== null ? (
                <p className="error-strip" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="card-foot">
                <span className="micro">Encrypted in your browser. Formatting stays intact.</span>
                <button className="button" type="submit" disabled={phase === 'creating' || overLimit}>
                  {phase === 'creating' ? 'Encrypting…' : 'Create private link'}
                </button>
              </div>
            </form>

            <div className="steps" id="how">
              <div className="step">
                <span className="step-num">1</span>
                <b>Paste your .env</b>
                <p>Add the variables your teammate needs, with line breaks and comments intact.</p>
              </div>
              <div className="step">
                <span className="step-num">2</span>
                <b>Send the link</b>
                <p>Share the private link with your teammate.</p>
              </div>
              <div className="step">
                <span className="step-num">3</span>
                <b>Read once</b>
                <p>Your teammate reveals and copies the variables. The shared copy is deleted.</p>
              </div>
            </div>
          </>
        )}
      </main>
      <SiteFooter
        left="env-gone — environment variables, shared once."
        right="Anyone with the complete link can read the note."
      />
    </div>
  );
}

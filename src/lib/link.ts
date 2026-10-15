import { ID_BASE64URL_LENGTH, KEY_BASE64URL_LENGTH, CONSUME_TOKEN_BASE64URL_LENGTH, PROTOCOL_VERSION } from '../../shared/protocol';

export interface LinkSecrets {
  /** AES-256-GCM key, base64url. Stays in memory only. */
  key: string;
  /** Raw consume token, base64url. Sent once, in a POST body. */
  token: string;
}

/** Builds the complete one-time link. The key and token live in the fragment. */
export function buildShareLink(origin: string, id: string, key: string, token: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/n/${id}#v=${PROTOCOL_VERSION}&k=${key}&t=${token}`;
}

/**
 * Parses the URL fragment into memory. Returns null when the fragment is
 * missing, malformed, or a different protocol version.
 */
export function parseFragment(fragment: string): LinkSecrets | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (raw.length === 0) {
    return null;
  }
  const params = new URLSearchParams(raw);
  if (params.get('v') !== String(PROTOCOL_VERSION)) {
    return null;
  }
  const key = params.get('k');
  const token = params.get('t');
  if (key === null || token === null) {
    return null;
  }
  const validKey = new RegExp(`^[A-Za-z0-9_-]{${KEY_BASE64URL_LENGTH}}$`).test(key);
  const validToken = new RegExp(`^[A-Za-z0-9_-]{${CONSUME_TOKEN_BASE64URL_LENGTH}}$`).test(token);
  if (!validKey || !validToken) {
    return null;
  }
  return { key, token };
}

export function isValidNoteId(id: string): boolean {
  return new RegExp(`^[A-Za-z0-9_-]{${ID_BASE64URL_LENGTH}}$`).test(id);
}

/** Removes the fragment from the address bar without adding a history entry. */
export function stripFragment(): void {
  if (window.location.hash.length === 0) {
    return;
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

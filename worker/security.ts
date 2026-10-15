/**
 * Rejects cross-origin API calls. The full origin (scheme, host, and port) must
 * match; comparing only the host would accept `http://host` against `https://host`.
 * Browsers send `Origin` on same-origin POSTs; non-browser clients may omit it.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    return true;
  }
  if (origin === 'null') {
    // Sandboxed frames and `file://` pages send the literal string "null".
    return false;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}


const DOCUMENT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function securityHeaders(): Headers {
  const headers = new Headers();
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-frame-options', 'DENY');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return headers;
}

/** A JSON API response. Never cacheable, never framed. */
export function jsonResponse(body: unknown, status = 200): Response {
  const headers = securityHeaders();
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('content-security-policy', API_CSP);
  return new Response(JSON.stringify(body), { status, headers });
}

export function methodNotAllowed(allow: string[]): Response {
  const response = jsonResponse({ error: 'method_not_allowed' }, 405);
  response.headers.set('allow', allow.join(', '));
  return response;
}

/**
 * Adds security headers to a static asset response and drops the body for HEAD.
 * Recipient pages are marked no-store and noindex.
 */
export function withDocumentHeaders(response: Response, pathname: string, method: string): Response {
  const headers = new Headers(response.headers);
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html');

  securityHeaders().forEach((value, key) => headers.set(key, value));

  if (isHtml) {
    headers.set('content-security-policy', DOCUMENT_CSP);
    headers.set('cache-control', 'no-store');
    if (pathname.startsWith('/n/')) {
      headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
    }
  }

  const body = method === 'HEAD' ? null : response.body;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

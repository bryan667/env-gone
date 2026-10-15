import type { Env } from './env';
import { jsonResponse, methodNotAllowed, withDocumentHeaders } from './http';
import { handleConsume, handleCreate } from './routes';
import { originAllowed } from './security';
import { isValidNoteId } from './validation';

const CONSUME_PATH = /^\/api\/notes\/([^/]+)\/consume$/;

/**
 * Safe error classifications only. Underlying exception messages are never
 * logged: a D1 error message can contain query text and bound values.
 */
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'NoteIdCollisionError',
]);

function classifyError(error: unknown): string {
  if (error instanceof Error && SAFE_ERROR_NAMES.has(error.name)) {
    return error.name;
  }
  return 'unknown_error';
}

async function handleApiRequest(request: Request, env: Env, pathname: string): Promise<Response> {
  if (!originAllowed(request)) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  if (pathname === '/api/notes') {
    if (request.method !== 'POST') {
      return methodNotAllowed(['POST']);
    }
    return handleCreate(request, env);
  }

  const consumeMatch = CONSUME_PATH.exec(pathname);
  if (consumeMatch !== null) {
    if (request.method !== 'POST') {
      return methodNotAllowed(['POST']);
    }
    const id = decodeURIComponent(consumeMatch[1]!);
    if (!isValidNoteId(id)) {
      return jsonResponse({ error: 'invalid_request' }, 400);
    }
    return handleConsume(request, env, id);
  }

  return jsonResponse({ error: 'not_found' }, 404);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    try {
      return await handleApiRequest(request, env, pathname);
    } catch (error) {
      console.error('api_request_failed', { classification: classifyError(error) });
      return jsonResponse({ error: 'temporarily_unavailable' }, 503);
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowed(['GET', 'HEAD']);
  }

  const assetResponse = await env.ASSETS.fetch(request);
  return withDocumentHeaders(assetResponse, pathname, request.method);
}

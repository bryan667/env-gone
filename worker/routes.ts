import { sha256Base64url } from '../shared/hash';
import { MAX_REQUEST_BYTES } from '../shared/protocol';
import type { Env } from './env';
import { jsonResponse } from './http';
import { insertNote, NoteIdCollisionError, consumeNote } from './notes';
import { parseConsumeInput, parseCreateNoteInput } from './validation';

type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * Reads a byte stream, aborting once it exceeds `limit` bytes. The bound is on
 * actual bytes, so it holds even when the client sends no `Content-Length` and
 * even for multibyte UTF-8, which character counting would undercount.
 * Returns null (and cancels the body) when the limit is exceeded.
 */
async function readLimitedBytes(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJsonBody(request: Request): Promise<BodyResult> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    await request.body?.cancel();
    return { ok: false, response: jsonResponse({ error: 'invalid_request' }, 400) };
  }

  // Fast path: reject early on a declared, oversized length. Never trust it as
  // an upper bound, though; the byte-accurate check below always runs.
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_REQUEST_BYTES) {
    await request.body?.cancel();
    return { ok: false, response: jsonResponse({ error: 'request_too_large' }, 413) };
  }

  const stream = request.body;
  if (stream === null) {
    return { ok: false, response: jsonResponse({ error: 'invalid_request' }, 400) };
  }

  const bytes = await readLimitedBytes(stream, MAX_REQUEST_BYTES);
  if (bytes === null) {
    return { ok: false, response: jsonResponse({ error: 'request_too_large' }, 413) };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { ok: false, response: jsonResponse({ error: 'invalid_request' }, 400) };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonResponse({ error: 'invalid_request' }, 400) };
  }
}

export async function handleCreate(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const input = parseCreateNoteInput(body.value);
  if (input === null) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + input.ttlSeconds;

  try {
    await insertNote(env.DB, {
      id: input.id,
      version: input.version,
      iv: input.iv,
      ciphertext: input.ciphertext,
      consumeTokenHash: input.consumeTokenHash,
      createdAt: nowSeconds,
      expiresAt,
    });
  } catch (error) {
    if (error instanceof NoteIdCollisionError) {
      return jsonResponse({ error: 'id_collision' }, 409);
    }
    throw error;
  }

  return jsonResponse({ id: input.id, expiresAt }, 201);
}

export async function handleConsume(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const consumeToken = parseConsumeInput(body.value);
  if (consumeToken === null) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256Base64url(consumeToken);
  const note = await consumeNote(env.DB, id, tokenHash, nowSeconds);

  if (note === null) {
    return jsonResponse({ error: 'unavailable' }, 410);
  }

  return jsonResponse({ version: note.version, iv: note.iv, ciphertext: note.ciphertext }, 200);
}

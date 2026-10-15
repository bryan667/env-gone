import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PLAINTEXT_BYTES, MAX_REQUEST_BYTES, PROTOCOL_VERSION } from '../shared/protocol';
import {
  decryptNote,
  encryptNote,
  newConsumeToken,
  newEncryptionKey,
  newNoteId,
  sha256Base64url,
} from '../src/lib/crypto';
import worker from '../worker/index';

const ORIGIN = 'https://example.com';

interface NoteRecord {
  id: string;
  version: number;
  iv: string;
  ciphertext: string;
  consume_token_hash: string;
  created_at: number;
  expires_at: number;
}

interface BuiltNote {
  id: string;
  key: string;
  token: string;
  payload: {
    version: number;
    id: string;
    iv: string;
    ciphertext: string;
    consumeTokenHash: string;
    ttlSeconds: number;
  };
}

async function buildNote(plaintext: string, ttlSeconds = 3600): Promise<BuiltNote> {
  const id = newNoteId();
  const key = newEncryptionKey();
  const token = newConsumeToken();
  const { iv, ciphertext } = await encryptNote(key, id, plaintext);
  const consumeTokenHash = await sha256Base64url(token);
  return {
    id,
    key,
    token,
    payload: { version: PROTOCOL_VERSION, id, iv, ciphertext, consumeTokenHash, ttlSeconds },
  };
}

function request(path: string, init: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
}

function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Sends a streamed body that has no Content-Length header. */
function postStream(
  path: string,
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): Promise<Response> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: stream,
  } as RequestInit & { body: ReadableStream<Uint8Array> });
}

function createNote(note: BuiltNote): Promise<Response> {
  return postJson('/api/notes', note.payload);
}

function consumeNote(id: string, consumeToken: string): Promise<Response> {
  return postJson(`/api/notes/${id}/consume`, { consumeToken });
}

function rowExists(id: string): Promise<boolean> {
  return env.DB.prepare('SELECT id FROM notes WHERE id = ?')
    .bind(id)
    .first()
    .then((row) => row !== null);
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM notes').run();
});

describe('POST /api/notes', () => {
  it('creates without authentication and stores only ciphertext and metadata', async () => {
    const note = await buildNote('APP_MODE=production\nAPI_KEY=sk-live-secret\n');

    const response = await createNote(note);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; expiresAt: number };
    expect(body.id).toBe(note.id);
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const row = await env.DB.prepare('SELECT * FROM notes WHERE id = ?')
      .bind(note.id)
      .first<NoteRecord>();
    expect(row).not.toBeNull();
    expect(row!.ciphertext).toBe(note.payload.ciphertext);
    expect(row!.iv).toBe(note.payload.iv);
    expect(row!.consume_token_hash).toBe(note.payload.consumeTokenHash);

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('APP_MODE=production');
    expect(serialized).not.toContain('sk-live-secret');
    expect(serialized).not.toContain(note.key);
    expect(serialized).not.toContain(note.token);
  });

  it('sets cache and content-type hardening headers', async () => {
    const response = await createNote(await buildNote('hello'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects a cross-origin request', async () => {
    const note = await buildNote('hello');
    const response = await postJson('/api/notes', note.payload, {
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
    expect(await rowExists(note.id)).toBe(false);
  });

  it('rejects an http origin against the same https host', async () => {
    const note = await buildNote('hello');
    const response = await postJson('/api/notes', note.payload, {
      origin: 'http://example.com',
    });
    expect(response.status).toBe(403);
    expect(await rowExists(note.id)).toBe(false);
  });

  it('rejects a null origin', async () => {
    const note = await buildNote('hello');
    const response = await postJson('/api/notes', note.payload, {
      origin: 'null',
    });
    expect(response.status).toBe(403);
  });

  it('accepts a same-origin request', async () => {
    const note = await buildNote('hello');
    const response = await postJson('/api/notes', note.payload, {
      origin: ORIGIN,
    });
    expect(response.status).toBe(201);
  });

  it('rejects malformed payloads', async () => {
    const note = await buildNote('hello');
    const base = note.payload;

    await expect(createNote({ ...note, payload: { ...base, version: 2 } })).resolves.toHaveProperty('status', 400);
    await expect(createNote({ ...note, payload: { ...base, id: 'too-short' } })).resolves.toHaveProperty('status', 400);
    await expect(createNote({ ...note, payload: { ...base, iv: 'AAAA' } })).resolves.toHaveProperty('status', 400);
    await expect(createNote({ ...note, payload: { ...base, ttlSeconds: 5 } })).resolves.toHaveProperty('status', 400);
    await expect(createNote({ ...note, payload: { ...base, consumeTokenHash: 'nope' } })).resolves.toHaveProperty('status', 400);

    const missing: Record<string, unknown> = { ...base };
    delete missing.ciphertext;
    await expect(createNote({ ...note, payload: missing } as unknown as BuiltNote)).resolves.toHaveProperty(
      'status',
      400,
    );
  });

  it('rejects ciphertext larger than the plaintext limit', async () => {
    const oversized = await buildNote('a'.repeat(MAX_PLAINTEXT_BYTES + 1));
    const response = await createNote(oversized);
    expect(response.status).toBe(400);
  });

  it('rejects a non-JSON body and an oversized body', async () => {
    const notJson = await postJson('/api/notes', 'not json', {
    });
    expect(notJson.status).toBe(400);

    const missingType = await request('/api/notes', {
      method: 'POST',
      body: '{}',
    });
    expect(missingType.status).toBe(400);

    const huge = `{"version":1,"pad":"${'a'.repeat(200 * 1024)}"}`;
    const tooLarge = await postJson('/api/notes', huge, {
    });
    expect(tooLarge.status).toBe(413);
  });

  it('rejects an oversized streamed body with no trusted length', async () => {
    const encoder = new TextEncoder();
    // Three 64 KiB chunks: ~192 KiB streamed with no Content-Length header.
    const chunk = encoder.encode(`"${'a'.repeat(64 * 1024 - 2)}"`);
    const response = await postStream('/api/notes', [chunk, chunk, chunk], {
    });
    expect(response.status).toBe(413);
  });

  it('bounds a multibyte streamed body by bytes, not characters', async () => {
    const encoder = new TextEncoder();
    // 60,000 '€' characters = 180,000 UTF-8 bytes but only 60,000 JS
    // characters, so a character-count check would have let this through.
    const multibyte = encoder.encode('€'.repeat(60_000));
    expect(multibyte.byteLength).toBeGreaterThan(MAX_REQUEST_BYTES);
    expect('€'.repeat(60_000).length).toBeLessThan(MAX_REQUEST_BYTES);
    const response = await postStream('/api/notes', [multibyte], {
    });
    expect(response.status).toBe(413);
  });

  it('accepts a valid note sent as a stream with no trusted length', async () => {
    const note = await buildNote('streamed note');
    const body = new TextEncoder().encode(JSON.stringify(note.payload));
    const response = await postStream(
      '/api/notes',
      [body.subarray(0, 5), body.subarray(5)],
    );
    expect(response.status).toBe(201);
    expect(await rowExists(note.id)).toBe(true);
  });

  it('round-trips multibyte note content through the API', async () => {
    const plaintext = 'KEY=é🌍\nMESSAGE=naïve café — ok\n';
    const note = await buildNote(plaintext);
    expect((await createNote(note)).status).toBe(201);

    const response = await consumeNote(note.id, note.token);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { iv: string; ciphertext: string };
    expect(await decryptNote(note.key, note.id, payload.iv, payload.ciphertext)).toBe(plaintext);
  });

  it('reports an id collision as retryable', async () => {
    const note = await buildNote('hello');
    expect((await createNote(note)).status).toBe(201);
    expect((await createNote(note)).status).toBe(409);
  });
});

describe('POST /api/notes/:id/consume', () => {
  it('returns ciphertext, deletes the row, and decrypts locally', async () => {
    const plaintext = 'TOKEN=abc123\n\nLine two.';
    const note = await buildNote(plaintext);
    await createNote(note);

    const response = await consumeNote(note.id, note.token);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { version: number; iv: string; ciphertext: string };
    expect(payload.version).toBe(PROTOCOL_VERSION);
    expect(await decryptNote(note.key, note.id, payload.iv, payload.ciphertext)).toBe(plaintext);
    expect(await rowExists(note.id)).toBe(false);
  });

  it('returns the same 410 on replay', async () => {
    const note = await buildNote('hello');
    await createNote(note);
    expect((await consumeNote(note.id, note.token)).status).toBe(200);
    expect((await consumeNote(note.id, note.token)).status).toBe(410);
  });

  it('does not delete the row on a wrong consume token', async () => {
    const note = await buildNote('hello');
    await createNote(note);
    const response = await consumeNote(note.id, newConsumeToken());
    expect(response.status).toBe(410);
    expect(await rowExists(note.id)).toBe(true);
    expect((await consumeNote(note.id, note.token)).status).toBe(200);
  });

  it('returns 410 for an unknown id and for malformed input 400', async () => {
    const unknown = await consumeNote(newNoteId(), newConsumeToken());
    expect(unknown.status).toBe(410);

    const malformedToken = await consumeNote(newNoteId(), 'not-a-token');
    expect(malformedToken.status).toBe(400);

    const malformedId = await consumeNote('short', newConsumeToken());
    expect(malformedId.status).toBe(400);

    const emptyBody = await postJson('/api/notes/abc/consume', {});
    expect(emptyBody.status).toBe(400);
  });

  it('never returns an expired note, and cleanup removes it', async () => {
    const note = await buildNote('hello');
    await createNote(note);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('UPDATE notes SET expires_at = ? WHERE id = ?')
      .bind(now - 60, note.id)
      .run();

    const response = await consumeNote(note.id, note.token);
    expect(response.status).toBe(410);
    expect(await rowExists(note.id)).toBe(true);

    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await rowExists(note.id)).toBe(false);
  });

  it('lets exactly one of two simultaneous consumes win', async () => {
    const note = await buildNote('race condition');
    await createNote(note);

    const [first, second] = await Promise.all([
      consumeNote(note.id, note.token),
      consumeNote(note.id, note.token),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 410]);
    expect(await rowExists(note.id)).toBe(false);
  });
});

describe('GET and HEAD never consume a note', () => {
  it('serves the confirmation shell without touching the row', async () => {
    const note = await buildNote('still here');
    await createNote(note);

    const getResponse = await request(`/n/${note.id}`, { method: 'GET' });
    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toContain('id="root"');
    expect(getResponse.headers.get('x-robots-tag')).toContain('noindex');
    expect(getResponse.headers.get('cache-control')).toBe('no-store');
    expect(await rowExists(note.id)).toBe(true);

    const headResponse = await request(`/n/${note.id}`, { method: 'HEAD' });
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe('');
    expect(await rowExists(note.id)).toBe(true);

    // A GET to the consume endpoint is not allowed and must not delete either.
    const getConsume = await request(`/api/notes/${note.id}/consume`, { method: 'GET' });
    expect(getConsume.status).toBe(405);
    expect(await rowExists(note.id)).toBe(true);
  });
});


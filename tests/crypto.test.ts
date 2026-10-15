import { describe, expect, it } from 'vitest';
import { base64urlToBytes, bytesToBase64url } from '../shared/base64url';
import { AAD_PREFIX, CONSUME_TOKEN_BYTES, ID_BYTES, IV_BYTES, KEY_BYTES } from '../shared/protocol';
import {
  decryptNote,
  encryptNote,
  newConsumeToken,
  newEncryptionKey,
  newNoteId,
  sha256Base64url,
} from '../src/lib/crypto';

function flipLastByte(base64url: string): string {
  const bytes = base64urlToBytes(base64url);
  const last = bytes.length - 1;
  bytes[last] = bytes[last]! ^ 0x01;
  return bytesToBase64url(bytes);
}

describe('crypto protocol', () => {
  it('generates values of exactly the documented sizes', async () => {
    expect(base64urlToBytes(newNoteId()).length).toBe(ID_BYTES);
    expect(base64urlToBytes(newEncryptionKey()).length).toBe(KEY_BYTES);
    expect(base64urlToBytes(newConsumeToken()).length).toBe(CONSUME_TOKEN_BYTES);
    const { iv, ciphertext } = await encryptNote(newEncryptionKey(), newNoteId(), 'hello');
    expect(base64urlToBytes(iv).length).toBe(IV_BYTES);
    expect(base64urlToBytes(ciphertext).length).toBe('hello'.length + 16);
  });

  it('generates fresh random values each time', () => {
    expect(newNoteId()).not.toBe(newNoteId());
    expect(newEncryptionKey()).not.toBe(newEncryptionKey());
    expect(newConsumeToken()).not.toBe(newConsumeToken());
  });

  it('round-trips multiline .env content byte for byte', async () => {
    const plaintext = 'APP_MODE=production\nAPI_KEY=sk-test-123\n\n# comment\nEMPTY=\n';
    const id = newNoteId();
    const key = newEncryptionKey();
    const { iv, ciphertext } = await encryptNote(key, id, plaintext);
    expect(await decryptNote(key, id, iv, ciphertext)).toBe(plaintext);
  });

  it('round-trips unicode and a full 64 KiB payload', async () => {
    const id = newNoteId();
    const key = newEncryptionKey();
    const plaintext = 'é🌍'.repeat(20000);
    const { iv, ciphertext } = await encryptNote(key, id, plaintext);
    expect(await decryptNote(key, id, iv, ciphertext)).toBe(plaintext);
  });

  it('fails authentication when the ciphertext is tampered with', async () => {
    const id = newNoteId();
    const key = newEncryptionKey();
    const { iv, ciphertext } = await encryptNote(key, id, 'top secret');
    await expect(decryptNote(key, id, iv, flipLastByte(ciphertext))).rejects.toThrow();
  });

  it('fails authentication when the IV is changed', async () => {
    const id = newNoteId();
    const key = newEncryptionKey();
    const { iv, ciphertext } = await encryptNote(key, id, 'top secret');
    await expect(decryptNote(key, id, flipLastByte(iv), ciphertext)).rejects.toThrow();
  });

  it('fails authentication with a different key', async () => {
    const id = newNoteId();
    const key = newEncryptionKey();
    const { iv, ciphertext } = await encryptNote(key, id, 'top secret');
    await expect(decryptNote(newEncryptionKey(), id, iv, ciphertext)).rejects.toThrow();
  });

  it('binds ciphertext to its note id via the AAD', async () => {
    const id = newNoteId();
    const otherId = newNoteId();
    const key = newEncryptionKey();
    const { iv, ciphertext } = await encryptNote(key, id, 'top secret');
    await expect(decryptNote(key, otherId, iv, ciphertext)).rejects.toThrow();
    expect(`${AAD_PREFIX}${id}`).toBe(`env-gone:v1:${id}`);
  });

  it('hashes consume tokens deterministically and uniquely', async () => {
    const token = newConsumeToken();
    const first = await sha256Base64url(token);
    const second = await sha256Base64url(token);
    expect(first).toBe(second);
    expect(base64urlToBytes(first).length).toBe(32);
    expect(await sha256Base64url(newConsumeToken())).not.toBe(first);
  });
});

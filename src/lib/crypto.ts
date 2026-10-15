import { base64urlToBytes, bytesToBase64url } from '../../shared/base64url';
import {
  aadForNoteId,
  CONSUME_TOKEN_BYTES,
  ID_BYTES,
  IV_BYTES,
  KEY_BYTES,
} from '../../shared/protocol';

export { sha256Base64url } from '../../shared/hash';

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function newNoteId(): string {
  return bytesToBase64url(randomBytes(ID_BYTES));
}

export function newConsumeToken(): string {
  return bytesToBase64url(randomBytes(CONSUME_TOKEN_BYTES));
}

export function newEncryptionKey(): string {
  return bytesToBase64url(randomBytes(KEY_BYTES));
}

async function importAesKey(keyBase64url: string): Promise<CryptoKey> {
  const raw = base64urlToBytes(keyBase64url);
  if (raw.length !== KEY_BYTES) {
    throw new Error('invalid key length');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface EncryptedNote {
  iv: string;
  ciphertext: string;
}

export async function encryptNote(
  keyBase64url: string,
  id: string,
  plaintext: string,
): Promise<EncryptedNote> {
  const key = await importAesKey(keyBase64url);
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aadForNoteId(id)) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: bytesToBase64url(iv), ciphertext: bytesToBase64url(new Uint8Array(ciphertext)) };
}

/**
 * Decrypts a note locally. Throws on any tampering with the ciphertext, IV, id,
 * or key; it never returns partial plaintext.
 */
export async function decryptNote(
  keyBase64url: string,
  id: string,
  ivBase64url: string,
  ciphertextBase64url: string,
): Promise<string> {
  const key = await importAesKey(keyBase64url);
  const iv = base64urlToBytes(ivBase64url);
  const ciphertext = base64urlToBytes(ciphertextBase64url);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aadForNoteId(id)) },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

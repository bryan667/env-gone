import { decodeBase64url } from '../shared/base64url';
import {
  ALLOWED_TTL_SECONDS,
  CONSUME_TOKEN_BYTES,
  GCM_TAG_BYTES,
  HASH_BYTES,
  ID_BYTES,
  IV_BYTES,
  MAX_CIPHERTEXT_BYTES,
  PROTOCOL_VERSION,
} from '../shared/protocol';

export interface CreateNoteInput {
  version: number;
  id: string;
  iv: string;
  ciphertext: string;
  consumeTokenHash: string;
  ttlSeconds: number;
}

export function isValidNoteId(id: string): boolean {
  return decodeBase64url(id, ID_BYTES) !== null;
}

export function parseCreateNoteInput(input: unknown): CreateNoteInput | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const value = input as Record<string, unknown>;

  if (value.version !== PROTOCOL_VERSION) {
    return null;
  }
  const { id, iv, ciphertext, consumeTokenHash, ttlSeconds } = value;

  if (typeof id !== 'string' || decodeBase64url(id, ID_BYTES) === null) {
    return null;
  }
  if (typeof iv !== 'string' || decodeBase64url(iv, IV_BYTES) === null) {
    return null;
  }
  if (typeof consumeTokenHash !== 'string' || decodeBase64url(consumeTokenHash, HASH_BYTES) === null) {
    return null;
  }
  if (typeof ciphertext !== 'string') {
    return null;
  }
  const ciphertextBytes = decodeBase64url(ciphertext);
  if (
    ciphertextBytes === null ||
    ciphertextBytes.length < GCM_TAG_BYTES ||
    ciphertextBytes.length > MAX_CIPHERTEXT_BYTES
  ) {
    return null;
  }
  if (typeof ttlSeconds !== 'number' || !ALLOWED_TTL_SECONDS.includes(ttlSeconds)) {
    return null;
  }

  return { version: PROTOCOL_VERSION, id, iv, ciphertext, consumeTokenHash, ttlSeconds };
}

export function parseConsumeInput(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const { consumeToken } = input as Record<string, unknown>;
  if (typeof consumeToken !== 'string' || decodeBase64url(consumeToken, CONSUME_TOKEN_BYTES) === null) {
    return null;
  }
  return consumeToken;
}

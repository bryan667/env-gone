/**
 * Protocol constants shared by the browser client and the Worker.
 *
 * Everything here is public. The AES key and the plaintext never appear in this
 * file and never leave the browser. The raw consume token stays in the browser
 * until the single consume `POST`, where it is sent once over HTTPS and stored
 * only as a SHA-256 hash by the server.
 */

export const PROTOCOL_VERSION = 1;

/** Raw byte lengths for generated values. */
export const ID_BYTES = 16;
export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const CONSUME_TOKEN_BYTES = 32;
export const HASH_BYTES = 32;
/** AES-GCM authentication tag length in bytes. */
export const GCM_TAG_BYTES = 16;

/** 64 KiB of UTF-8 plaintext, plus the GCM tag for the ciphertext. */
export const MAX_PLAINTEXT_BYTES = 64 * 1024;
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + GCM_TAG_BYTES;

/** Upper bound for a whole request body; ciphertext is base64url-expanded. */
export const MAX_REQUEST_BYTES = 160 * 1024;

/** base64url character lengths for the fixed-size values. */
export const ID_BASE64URL_LENGTH = 22; // 16 bytes
export const KEY_BASE64URL_LENGTH = 43; // 32 bytes
export const IV_BASE64URL_LENGTH = 16; // 12 bytes
export const CONSUME_TOKEN_BASE64URL_LENGTH = 43; // 32 bytes
export const HASH_BASE64URL_LENGTH = 43; // 32 bytes

export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface TtlOption {
  readonly seconds: number;
  readonly label: string;
}

export const TTL_OPTIONS: readonly TtlOption[] = [
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '1 day' },
  { seconds: 604800, label: '7 days' },
  { seconds: 2592000, label: '30 days' },
];

export const ALLOWED_TTL_SECONDS: readonly number[] = TTL_OPTIONS.map((option) => option.seconds);

export const DEFAULT_TTL_SECONDS = 2592000;

/** Authenticated additional data binds ciphertext to exactly one note id. */
export const AAD_PREFIX = 'env-gone:v1:';

export function aadForNoteId(id: string): string {
  return `${AAD_PREFIX}${id}`;
}

export function ttlLabel(seconds: number): string {
  return TTL_OPTIONS.find((option) => option.seconds === seconds)?.label ?? `${seconds} seconds`;
}

/** The single "not available" message for missing, expired, consumed, or wrong-token notes. */
export const UNAVAILABLE_MESSAGE =
  'This note is no longer available. It may have been read, expired, or the link may be incomplete.';

/** Shown after a successful consume. The exact wording is part of the contract. */
export const DESTROYED_WARNING =
  'This note was destroyed. If you need to keep it, copy it before closing this window.';

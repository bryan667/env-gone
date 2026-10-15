/**
 * Strict base64url encoding without padding, usable in both the browser and
 * the Workers runtime (both provide `btoa`/`atob`).
 */

import { BASE64URL_PATTERN } from './protocol';

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error('invalid base64url value');
  }
  if (value.length % 4 === 1) {
    throw new Error('invalid base64url length');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const binary = atob(remainder === 0 ? padded : padded + '='.repeat(4 - remainder));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodeBase64url(
  value: string,
  expectedBytes?: number,
): Uint8Array<ArrayBuffer> | null {
  try {
    const bytes = base64urlToBytes(value);
    if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

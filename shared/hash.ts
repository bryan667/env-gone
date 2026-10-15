import { bytesToBase64url } from './base64url';

/** SHA-256 of the UTF-8 bytes of `value`, returned as an unpadded base64url string. */
export async function sha256Base64url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64url(new Uint8Array(digest));
}

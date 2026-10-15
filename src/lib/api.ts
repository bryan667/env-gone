export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface CreateNotePayload {
  version: number;
  id: string;
  iv: string;
  ciphertext: string;
  consumeTokenHash: string;
  ttlSeconds: number;
}

export interface CreateNoteResult {
  id: string;
  expiresAt: number;
}

export interface ConsumeNoteResult {
  version: number;
  iv: string;
  ciphertext: string;
}

const REQUEST_OPTIONS: RequestInit = {
  cache: 'no-store',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
};

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    /* ignore malformed error bodies */
  }
  return 'error';
}

export async function createNote(
  payload: CreateNotePayload,
): Promise<CreateNoteResult> {
  const response = await fetch('/api/notes', {
    ...REQUEST_OPTIONS,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (response.status !== 201) {
    throw new ApiError(response.status, await errorCode(response));
  }
  return (await response.json()) as CreateNoteResult;
}

/**
 * Single consume attempt. Callers must not retry automatically: the first
 * request may have succeeded even if its response was lost.
 */
export async function consumeNote(id: string, consumeToken: string): Promise<ConsumeNoteResult> {
  const response = await fetch(`/api/notes/${encodeURIComponent(id)}/consume`, {
    ...REQUEST_OPTIONS,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consumeToken }),
  });
  if (response.status !== 200) {
    throw new ApiError(response.status, await errorCode(response));
  }
  return (await response.json()) as ConsumeNoteResult;
}

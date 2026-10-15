export interface StoredNote {
  version: number;
  iv: string;
  ciphertext: string;
}

export interface NewNote extends StoredNote {
  id: string;
  consumeTokenHash: string;
  createdAt: number;
  expiresAt: number;
}

/** Raised when two creations race for the same random id. */
export class NoteIdCollisionError extends Error {
  constructor() {
    super('note id already exists');
    this.name = 'NoteIdCollisionError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique/i.test(message);
}

export async function insertNote(db: D1Database, note: NewNote): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO notes (id, version, iv, ciphertext, consume_token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        note.id,
        note.version,
        note.iv,
        note.ciphertext,
        note.consumeTokenHash,
        note.createdAt,
        note.expiresAt,
      )
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new NoteIdCollisionError();
    }
    throw error;
  }
}

/**
 * The one-time-read boundary. A single atomic statement deletes and returns the
 * note. Concurrent requests for the same row can only ever see one winner.
 * A wrong token never matches, so it never deletes anything.
 */
export async function consumeNote(
  db: D1Database,
  id: string,
  consumeTokenHash: string,
  nowSeconds: number,
): Promise<StoredNote | null> {
  const result = await db
    .prepare(
      `DELETE FROM notes
        WHERE id = ? AND consume_token_hash = ? AND expires_at > ?
        RETURNING version, iv, ciphertext`,
    )
    .bind(id, consumeTokenHash, nowSeconds)
    .all<StoredNote>();

  return result.results.length > 0 ? result.results[0]! : null;
}

/** Deletes expired rows. Exact expiry is still enforced by `consumeNote`. */
export async function purgeExpired(db: D1Database, nowSeconds: number): Promise<number> {
  const result = await db.prepare('DELETE FROM notes WHERE expires_at <= ?').bind(nowSeconds).run();
  return result.meta.changes ?? 0;
}

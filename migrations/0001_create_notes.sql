-- One row per unread note. Only ciphertext and metadata are stored.
-- Never add plaintext, the AES key, the raw consume token, the creator token,
-- an IP address, or the share link to this table.

CREATE TABLE IF NOT EXISTS notes (
  id                 TEXT    PRIMARY KEY NOT NULL,
  version            INTEGER NOT NULL,
  iv                 TEXT    NOT NULL,
  ciphertext         TEXT    NOT NULL,
  consume_token_hash TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_expires_at ON notes (expires_at);

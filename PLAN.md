# env-gone: implementation plan (as built)

> Status: implemented. This document describes the finished MVP. It replaces
> the earlier Next.js / Vercel / Neon handoff. `design-preview.html` remains the
> static visual reference.

## Goal and decisions

A small, publicly reachable web app focused on developer handoffs of environment
variables, `.env` values, API keys, and database URLs through a one-time link.
Positioning: **Share your .env. Then it's gone.** The shared copy is deleted;
the underlying credentials are not revoked or rotated. The recipient sees a
confirmation screen first. Pressing the button consumes the note exactly once
and displays it with the warning: **This note was destroyed. If you need to keep
it, copy it before closing this window.**

- **Frontend:** React + TypeScript, built with Vite into static assets.
- **Backend:** one Cloudflare Worker that serves the static assets and the API.
- **Storage:** Cloudflare D1 (SQLite). Persistent, durable, and free at this
  scale, with no hibernating app server to wake. A request can still add a small
  amount of latency.
- **Hosting:** Cloudflare's free plan. No Next.js, no Vercel, no Neon, no
  serverless Postgres.

The tool is a personal MVP. The data model is deliberately small (one `notes`
table) so later features (password-protected notes, destruction notifications,
accounts) can be added without changing the one-time-read contract.

## User experience

1. `/` — multiline plain-text editor with `.env` formatting, a clear 64 KiB
   UTF-8 limit, an expiry selector (1 hour, 1 day, 7 days, 30 days; default
   30 days), and **Create private link**. Creating a share requires no account or creator token.
2. Creation happens in the browser: encrypt, upload ciphertext, then show the
   complete one-time link with **Copy link** and its expiry. The editor is
   cleared after success. No server-rendered preview is shown.
3. `/n/<id>#v=1&k=<key>&t=<token>` — shows **Read and destroy?**, the note id in
   a monospace badge, an explanation that the action is irreversible, and the
   **Yes, show me the variables** button. Page load, `HEAD`, reloads, and link
   previews never consume a note.
4. On button click, one `POST` consumes the note. The plaintext is shown as
   inert text in a wrapping monospace panel, with the exact destroyed warning
   and **Copy variables**. The plaintext is never written to
   `localStorage`/`sessionStorage`/cookies.
5. A second visit, an expired or malformed link, or a wrong consume token gets
   the same unavailable message, without revealing which condition applied. If
   the recipient reloads after the app has removed the fragment, the app
   explains that the original complete link is needed.

## Visual design

`design-preview.html` is the starting point. The product feels calm and precise:
mostly white, generous space, near-black type, soft gray surfaces, one restrained
blue action color.

| Token | Value |
| --- | --- |
| Page background | `#ffffff` |
| Soft surface | `#f5f5f7` |
| Main text | `#1d1d1f` |
| Secondary text | `#6e6e73` |
| Divider | `#e5e5e8` |
| Primary blue | `#0066cc` (hover `#0055ad`) |
| Type | system UI stack; system monospace for notes |
| Width | main content max 720 px; header max 1080 px; 24 px mobile padding |
| Geometry | 16–20 px card radii, 12 px input radii, 44 px minimum control height |

States implemented: create composer, link-ready card, read-and-destroy
confirmation, revealed note, unavailable, incomplete link, and transient error.
Responsive single column, visible labels, keyboard focus, disabled/loading
states, `aria-live` status, and reduced-motion support.

## Architecture and file structure

```text
env-gone/
├─ index.html
├─ src/
│  ├─ main.tsx                     # pathname router (composer vs. recipient)
│  ├─ styles.css                   # tokens and layout
│  ├─ components/
│  │  ├─ Chrome.tsx                # header, footer, logo
│  │  ├─ CreatePage.tsx            # composer + link-ready states
│  │  └─ ReadNote.tsx              # confirm, consuming, revealed, errors
│  └─ lib/
│     ├─ crypto.ts                 # AES-GCM encrypt/decrypt, key generation
│     ├─ link.ts                   # fragment build/parse/strip
│     ├─ api.ts                    # create/consume clients
│     └─ clipboard.ts              # copy with legacy fallback
├─ shared/
│  ├─ protocol.ts                  # version, sizes, TTLs, AAD, copy strings
│  ├─ base64url.ts                 # strict unpadded base64url
│  └─ hash.ts                      # SHA-256 → base64url
├─ worker/
│  ├─ index.ts                     # fetch + scheduled handlers
│  ├─ handler.ts                   # routing, asset pass-through, headers
│  ├─ routes.ts                    # create/consume handlers
│  ├─ notes.ts                     # insert, atomic DELETE RETURNING, purge
│  ├─ validation.ts                # body/binary/TTL/id validation
│  ├─ security.ts                  # origin check
│  ├─ http.ts                      # security headers and JSON responses
│  └─ env.ts                       # bindings and `Cloudflare.Env`
├─ migrations/0001_create_notes.sql
├─ public/                         # favicon.svg, robots.txt
├─ tests/                          # crypto + D1 integration tests
│  └─ browser/smoke.mjs            # optional real-browser CDP smoke test
├─ vite.config.ts / vitest.config.ts
└─ wrangler.jsonc
```

Browser and server code share only `shared/`. The Worker imports no browser
code; the browser imports no Worker code.

## Routes and state transitions

| Route and method | Behavior | Security rule |
| --- | --- | --- |
| `GET /` | Static SPA shell (composer) | No note or token is serialized into HTML |
| `GET /n/<id>` | Static SPA shell with SPA fallback; confirmation is rendered client-side | No database access on load; `noindex`, `no-store` |
| `POST /api/notes` | Insert encrypted row, `201 { id, expiresAt }` | Public creation; no AES key, raw consume token, or plaintext accepted |
| `POST /api/notes/<id>/consume` | One atomic delete and ciphertext response | Raw consume token in body; `410` for unavailable |
| `GET /api/notes/<id>/consume` | `405` | Never consumes |
| scheduled (`17 3 * * *`) | Deletes expired rows | Counts only, never note data |

Recipient state flow: `incomplete` → `confirm` → `consuming` → `revealed`, with
`unavailable` and `error` states. Invalid or incomplete links stop before
`consuming`. A same-document `hashchange` (reopening the full link in the same
tab) replaces the held link and returns to `confirm` without consuming, and a
stale consume response is discarded if the link changed. Consume `POST`s are
never retried automatically.

Request/response shapes (binary fields are unpadded base64url strings):

```text
POST /api/notes
Body: { version: 1, id, iv, ciphertext, consumeTokenHash, ttlSeconds }
201:  { id, expiresAt }
400:  { error: "invalid_request" }
409:  { error: "id_collision" }
413:  { error: "request_too_large" }
503:  { error: "temporarily_unavailable" }

POST /api/notes/<id>/consume
Body: { consumeToken }
200:  { version: 1, iv, ciphertext }
410:  { error: "unavailable" }
503:  { error: "temporarily_unavailable" }
```

Allowed TTL values are `3600`, `86400`, `604800`, and `2592000` seconds. A wrong
token leaves the row intact. Cross-origin API calls are rejected.

## Trust model and crypto protocol

- Random 128-bit note id, 256-bit AES key, 256-bit consume token, and 96-bit IV,
  generated with browser `crypto.getRandomValues` and encoded as base64url.
- Browser Web Crypto AES-256-GCM, with `env-gone:v1:<id>` as authenticated
  additional data so ciphertext from another id fails authentication.
- The browser sends `{ version, id, iv, ciphertext, consumeTokenHash, ttlSeconds }`
  where `consumeTokenHash = SHA-256(consume token)`. The AES key exists only in
  the URL fragment and browser memory; the raw consume token stays in the
  fragment until the single consume request, and the server stores only its hash.
- On the recipient page the fragment is parsed into memory and removed with
  `history.replaceState`. A same-document `hashchange` (reopening the full link
  in the same tab) re-parses and re-strips the fragment without consuming. The
  button sends the raw consume token in a `POST` body over HTTPS. The server
  hashes it, atomically deletes and returns the row, and the browser decrypts
  locally.
- Possession of the **complete** link is the authorization to read. This does not
  verify identity. Product wording must not promise otherwise.
- "Destroyed" means the app cannot serve the row again after a successful
  consume. Encrypted bytes may briefly remain in provider backups or replicas;
  those are not plaintext, but anyone who holds the complete link (and therefore
  the key) could decrypt a copy they obtained. Failed delivery after deletion can
  permanently lose the note.

## Storage and API contract

One D1 table (`migrations/0001_create_notes.sql`):

```sql
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
```

Binary values are stored as unpadded base64url text to keep D1 binding simple.
Expiry is an integer Unix time in seconds chosen by the server from the
allowlist; client timestamps are never trusted. No plaintext, AES key, raw
consume token, IP address, or link is stored.

The single `DELETE ... RETURNING` statement is the one-time-read boundary: two
concurrent consume requests yield exactly one successful response.

## Security and operational requirements

- Note creation is public and requires no creator token. The Worker requires no application secrets.
- `wrangler.jsonc` uses `run_worker_first: true` with
  `not_found_handling: "single-page-application"`, so every response gets the
  security headers and `/n/<id>` falls back to the SPA shell.
- API responses: `Cache-Control: no-store`, `Content-Security-Policy:
  default-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`, `X-Frame-Options: DENY`.
- Document responses: strict CSP (no third-party scripts), plus
  `X-Robots-Tag: noindex, nofollow, noarchive` on `/n/*`.
- 64 KiB plaintext limit enforced in the browser and by ciphertext length on the
  server; whole-request limit of 160 KiB counted in actual bytes, so an absent or
  untrusted `Content-Length` and multibyte UTF-8 cannot bypass it. Base64url
  lengths, protocol version, and TTL are validated.
- Note content is rendered as inert text. No Markdown, HTML, embeds, images, or
  linkification. No analytics, external scripts, or CDN fonts.
- Logs never include request bodies, fragments, plaintext, ciphertext, or
  tokens. Only fixed event names, safe error classifications, and cleanup counts
  are logged; underlying exception messages are never logged.
- Cross-origin API calls are rejected by comparing the full origin, including
  the scheme, so an `http://` origin against the same `https://` host is denied.
- The app fails closed: a database failure reports a temporary error and never
  claims a note was consumed without a successful delete.

## Local development and deployment

Local development uses Wrangler's persistent local D1 in `.wrangler/state`.
`npm run dev` builds the SPA and serves the Worker, assets, and D1 on
`http://127.0.0.1:8787`. `npm run dev:api` + `npm run dev:ui` provide a Vite
hot-reload workflow with `/api` proxied.

Deployment: `npx wrangler login`, `npx wrangler d1 create env-gone`, put the id
in `wrangler.jsonc`, `npm run db:migrate:remote`, then `npm run deploy`. See `README.md` for the full walkthrough.

## Verification

`npm run build`, `npm run typecheck`, and `npm test` pass. Tests run inside the
real Workers runtime against a real local D1 database:

- Crypto: round-trip (including 64 KiB and unicode) and tamper detection for
  ciphertext, IV, key, and id/AAD.
- API/D1: create stores only ciphertext and metadata; create validation and
  public creation; `409` id collision; consume returns ciphertext and deletes the
  row; replay, wrong token (row preserved), unknown id, and malformed input;
  streamed bodies with no trusted length, a multibyte body that character
  counting would miss, and multibyte round-trip; full-origin rejection including
  the scheme; expired notes are never returned and are removed by the scheduled
  cleanup; exactly one of two concurrent consumes wins.
- `GET`/`HEAD` of `/n/<id>` and `GET` of the consume endpoint never consume a
  note.
- A real headless-Chrome run against `wrangler dev` covered the full UI flow:
  create, open (confirmation only, fragment stripped, no browser-stored
  secrets), same-tab reopening of the full link, reload does not consume, reveal
  matches the input exactly, replay is unavailable with an honest footer, and
  markup-like content renders as inert text. This is available as the optional
  `npm run test:browser` smoke script.

## Hosting note (checked 2026-10-15)

Cloudflare Workers, static assets, and D1 all have free tiers sufficient for
personal, low-traffic use. The frontend is served as static files from the edge
and the API runs on demand, so there is no hibernating app server to wake, though
a request can still add a small amount of latency. This replaced the earlier
Vercel + Neon plan. Limits can change; check the Cloudflare dashboards before
relying on them.

References: [Privnote core flow](https://privnote.com/),
[Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
[Cloudflare D1](https://developers.cloudflare.com/d1/),
[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/),
[Web Crypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt),
[SQLite DELETE RETURNING](https://www.sqlite.org/lang_returning.html),
[OWASP CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html).

# env-gone

**Share your .env. Then it's gone.**

Live app: <https://env-gone.env-gone.workers.dev>

env-gone is a private handoff for environment variables: paste `.env` values,
API keys, or database URLs and send your teammate a link that works **once**.
Formatting, comments, and line breaks stay intact. The shared copy is deleted
when revealed; the credentials themselves are not revoked or rotated.

The recipient sees a confirmation screen first. Pressing the button consumes
the note exactly once and reveals it with the warning:

> This note was destroyed. If you need to keep it, copy it before closing this window.

The note is encrypted in the browser. The server stores only ciphertext and a
little metadata, and never sees the decryption key or the plaintext.

## How it works

1. **Create** (`/`). The browser generates a random 16-byte id, a fresh 32-byte
   AES-256-GCM key, a 12-byte IV, and a 32-byte consume token. The note is
   encrypted locally with AAD `env-gone:v1:<id>`. The browser sends only
   `{ version, id, iv, ciphertext, consumeTokenHash, ttlSeconds }` to the API.
   The AES key stays only in the link fragment and browser memory; the raw
   consume token also stays in the fragment until the consume request.
2. **Share** (`/n/<id>#v=1&k=<key>&t=<token>`). The key never reaches the
   server; URL fragments are not part of the HTTP request.
3. **Open**. The recipient page shows a confirmation shell only. Opening,
   reloading, `GET`, `HEAD`, and link previews never consume the note and never
   return ciphertext. The fragment is parsed into memory and immediately removed
   from the address bar with `history.replaceState`. Reopening the full link in
   the same tab re-reads the fragment (a same-document `hashchange`), strips it
   again, and still does not consume the note.
4. **Consume**. The explicit button sends a single `POST` carrying the raw
   consume token. That is the only request that includes it, and the server
   stores only its SHA-256 hash, never the token itself. One atomic D1 statement
   deletes and returns the row:

   ```sql
   DELETE FROM notes
    WHERE id = ? AND consume_token_hash = ? AND expires_at > ?
    RETURNING version, iv, ciphertext
   ```

5. **Reveal**. The ciphertext is decrypted locally and rendered as inert plain
   text. A replay, an expired link, or a wrong token all return the same `410`.

## Stack

- **Frontend:** React + TypeScript built with Vite, served as static assets.
- **Backend:** one Cloudflare Worker (API + static asset routing) on the free
  plan. The frontend is static files served from Cloudflare's edge, and the API
  is on-demand with no hibernating app server to wake; a request can still add a
  small amount of latency, and the free plan may cold-start occasionally.
- **Storage:** Cloudflare D1 (SQLite), free tier.
- **Crypto:** browser Web Crypto only (`AES-256-GCM`, `SHA-256`).

## Repository layout

```text
env-gone/
├─ index.html                 # Vite entry
├─ src/                       # browser UI and crypto
│  ├─ components/             # create page, read page, chrome
│  ├─ lib/                    # crypto, link parsing, API client, clipboard
│  └─ styles.css              # design tokens and layout
├─ shared/                    # constants + base64url/hash used by both sides
├─ worker/                    # Worker routes, repository, validation, headers
├─ migrations/                # D1 schema
├─ tests/                     # crypto + real local D1 integration tests
│  └─ browser/smoke.mjs       # optional real-browser CDP smoke test
├─ public/                    # favicon, robots.txt
├─ wrangler.jsonc             # Worker, D1, assets, cron
└─ vite.config.ts / vitest.config.ts
```

## Prerequisites

- Node.js 20.19+ (or 22.12+) and npm.
- A Cloudflare account (free) for deployment. Not needed for local development.

## Local development

```bash
npm install
```

Creating shares is public. No creator token or application secret is needed.

### Run it

```bash
npm run db:migrate:local     # create the local D1 schema (.wrangler/state)
npm run dev                  # build the SPA, then serve Worker + assets + local D1
```

Open <http://127.0.0.1:8787>.

Local development uses **Wrangler's persistent local D1** in `.wrangler/state`;
it never falls back to an in-memory or remote store.

### Optional UI-only dev server

For fast React iteration with hot reload, run the Worker and Vite side by side:

```bash
npm run dev:api    # terminal 1: wrangler dev on http://127.0.0.1:8787
npm run dev:ui     # terminal 2: vite on http://127.0.0.1:5173 (proxies /api)
```

`npm run dev` is the closer-to-production path because it serves the built SPA
from the Worker.

## Deploying to Cloudflare (free)

The checked-in `wrangler.jsonc` is configured for this app's Cloudflare account
and existing `env-gone` D1 database. Its initial remote migration has been
applied, and the Worker and daily cleanup trigger are deployed. Production
verification passed all 29 browser checks and an eight-request consume race
(exactly one successful read). To deploy updates to that account:

```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy
```

Cloudflare requires a verified account email before publishing Workers. If a
deployment reports error `10034`, verify the email and rerun `npm run deploy`.

For a separate Cloudflare account, provision a new database instead:

1. Log in and create the D1 database:

   ```bash
   npx wrangler login
   npx wrangler d1 create env-gone
   ```

2. Set `account_id` to that account's ID (shown by `npx wrangler whoami`) and
   copy the printed `database_id` into `wrangler.jsonc`
   (`d1_databases[0].database_id`).

3. Apply the schema to the remote database:

   ```bash
   npm run db:migrate:remote
   ```

4. Build and deploy:

   ```bash
   npm run deploy
   ```

The Worker serves the SPA, the API, and `/n/<id>` (SPA fallback) from one
`*.workers.dev` hostname. No other hosting is required.

### Expiry cleanup

A cron trigger runs daily (`17 3 * * *`) and deletes expired rows. Exact expiry
is also enforced by the consume statement, so a late sweep never makes an
expired note readable.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the SPA into `dist/` |
| `npm run dev` | Build then run Worker + assets + local D1 |
| `npm run dev:api` | Run only the Worker (for `dev:ui`) |
| `npm run dev:ui` | Vite dev server with `/api` proxy |
| `npm run typecheck` | Type-check the app and the Worker |
| `npm test` | Run crypto and D1 integration tests |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run test:browser` | Optional real-browser smoke test against `npm run dev` |
| `npm run db:migrate:local` | Apply migrations to the local D1 |
| `npm run db:migrate:remote` | Apply migrations to the remote D1 |
| `npm run deploy` | Build and deploy to Cloudflare |

## Tests

Tests run inside the real Workers runtime (workerd) against a real local D1
database, using `@cloudflare/vitest-plugin`.

- `tests/crypto.test.ts` — AES-GCM round-trips (including 64 KiB and unicode),
  and tamper detection for ciphertext, IV, key, and id/AAD.
- `tests/notes-api.test.ts` — create/consume/expiry/wrong-token/unknown-id,
  concurrent consumes (exactly one winner), public creation, malformed, oversized,
  streamed, and multibyte request bodies, full-origin (scheme included)
  rejection, `GET`/`HEAD` never consuming, and the scheduled cleanup handler.

```bash
npm test
```

### Optional browser smoke test

`npm test` never requires a browser. A real Chromium/Chrome smoke test covers the
UI flow (create → open → confirm → reveal → replay), including same-tab reopening
of the full link, inert-text rendering, and browser-storage checks. Start the dev
server first, then run it in a second terminal:

```bash
npm run dev   # terminal 1
npm run test:browser                                # terminal 2
```

It locates an installed Chrome/Chromium automatically; set `CHROME_PATH` to
override. This optional script uses Node's built-in WebSocket and requires
Node.js 22.12+; the normal build and runtime tests do not require a browser.
Fake notes only. Set `ENV_GONE_SCREENSHOTS` to a local directory to also capture
the empty desktop and mobile composer for visual review.

The smoke checks include duplicate clicks, damaged links/keys, browser history,
and a response arriving after the page has been left. Leaving a recipient page
clears its held key and visible plaintext; returning requires the original full
link, and a consumed note remains unavailable.

## Security and privacy

- AES-256-GCM in the browser. The server never sees the AES key or the
  plaintext. The raw consume token reaches the server exactly once, in the
  consume request, and is stored only as a SHA-256 hash. Stored data is the
  ciphertext, IV, protocol version, consume-token hash, the id, and timestamps.
- Possession of the **complete** link is the authorization to read. There is no
  recipient account or identity check.
- API responses are `Cache-Control: no-store`. Recipient pages send
  `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and a strict CSP
  with no third-party scripts.
- Notes are rendered as inert text only. Markdown, HTML, embeds, images, and
  linkification are not used.
- No analytics, no external scripts, no CDN fonts. System fonts only.
- The consume `POST` is never retried automatically, because a lost response can
  mean the note was already destroyed.

## Limitations of one-time deletion

- "Destroyed" means the app cannot serve the row again after a successful
  consume. Encrypted bytes may still exist briefly in provider backups or
  replicas. They are not plaintext, but they are only as safe as the link:
  anyone who holds the complete link, and therefore the key, could decrypt a
  copy of that ciphertext if they also obtained it. Without the key, a backup
  copy is unreadable.
- If the network fails after the row is deleted but before the recipient sees
  the plaintext, the note is gone. The recipient can copy the plaintext while it
  is on screen; after that the app cannot retrieve it again.
- Anyone who obtains the complete link first can read and destroy the note. A
  recipient can copy, photograph, or forward visible plaintext.
- A browser extension, a link scanner that executes JavaScript **and clicks the
  button**, or a compromised device can consume a note.

## Configuration reference

| Name | Type | Where | Purpose |
| --- | --- | --- | --- |
| `DB` | D1 binding | `wrangler.jsonc` | Note storage |
| `ASSETS` | assets binding | `wrangler.jsonc` | Serves the built SPA with SPA fallback |

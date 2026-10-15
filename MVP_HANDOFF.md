# Build env-gone MVP

Implement the functional MVP now. Use `design-preview.html` and the visual/behavior portions of `PLAN.md`. This handoff supersedes PLAN.md wherever the older Next.js/Vercel/Neon architecture conflicts with the decisions below. Update PLAN.md to match the finished implementation.

## Current decisions

- Use React + Vite + TypeScript for a static frontend, one Cloudflare Worker for the API/static assets, and Cloudflare D1 for durable storage. The owner wants free hosting with no long wake-up delay after idle periods. Minor request latency is fine. Keep the stack small; Next.js is not required.
- The owner asked for a functional personal MVP. Avoid extra features or elaborate abstractions. Preserve the essential privacy and single-consumption behavior.
- The repository contains a user-owned `.env`. DO NOT read, print, modify, attach, or send its contents to any model/tool. Leave it alone. Use `.dev.vars.example` and documented Wrangler secrets for configuration. Do not deploy, provision cloud resources, push, or commit. Work only in this checkout.

## Required behavior

1. `/`: plain-text editor with `.env` formatting, UTF-8 byte limit of 64 KiB, expiry options 1 hour/8 hours/1 day/7 days (default 1 hour), and create button. Creating a share is public: do not require a creator token or show a creator-token field.
2. Encrypt plaintext in the browser with Web Crypto AES-256-GCM, a fresh random 32-byte key, 12-byte IV, 16-byte ID, and 32-byte consume token. Use AAD `env-gone:v1:<id>`. Store only ciphertext, IV, protocol version, SHA-256 consume-token hash, ID and timestamps.
3. Share link `/n/<id>#v=1&k=<base64url-key>&t=<base64url-consume-token>`. Key never reaches the server. On recipient load parse fragment into memory and remove fragment with history.replaceState. Do not store secrets in localStorage/sessionStorage/cookies.
4. Opening a link shows a confirmation shell only. GET/HEAD/prefetch must never consume a note or return its ciphertext. The explicit button POSTs the consume token.
5. Atomic D1 statement: `DELETE FROM notes WHERE id = ? AND consume_token_hash = ? AND expires_at > ? RETURNING version, iv, ciphertext`. Expiry is an integer Unix time in seconds; bind server time. Test this using the real local D1 runtime. Do not implement SELECT followed by DELETE as two independent operations. Exactly one simultaneous consume can receive ciphertext.
6. Decrypt returned data locally, display plain text and the exact warning: **This note was destroyed. If you need to keep it, copy it before closing this window.** Include Copy note. A replay returns a generic unavailable state.
7. Missing/expired/consumed/wrong-token notes get the same 410 response, while malformed requests and service failures can use 400/503. Wrong consume token must not delete a row. Do not auto-retry consume POSTs.

## Implementation shape

Use a compact structure such as `src/` for browser React UI/crypto, `worker/` for routes/repository/validation, `migrations/` for D1 schema, and `tests/` for meaningful checks. Add Vite and Wrangler config, npm scripts for build/dev/test/local D1 migration/remote D1 migration/deploy, and a committed lockfile. Use D1 string columns for base64url binary data if that simplifies binding. Use Wrangler local persistent D1 for local development; never silently fall back to an in-memory production store.

Serve the frontend using Worker static assets with SPA fallback for `/n/<id>`. Keep API responses uncached; set no-store, no-referrer, noindex on recipient pages, nosniff, and a suitable CSP/frame protection. Use an original small logo, local fonts, no analytics/external scripts. Render no Markdown/HTML from notes. Enforce request-size limits on the server, validate binary lengths/versions/TTL/IDs, and keep logs free of secrets. Add scheduled expiry cleanup through the Worker scheduled handler; exact expiry checks apply even when cleanup is delayed.

## Verification and delivery

Run the build and tests. Include crypto roundtrip/tamper checks and local D1 integration tests for create/consume/expiry/wrong token/concurrent consume. Verify GET and HEAD do not burn a note. Test the whole UI flow if a browser is available; report limitations honestly. Use fake notes only. Document free Cloudflare setup, D1 creation and migration, local running, deployment, and the fact that one-time deletion means no further retrieval through the app (encrypted bytes may exist in provider backups, and the recipient can copy plaintext).

Finish with working source and a concise summary of files, test results, and commands to run locally. Preserve the clean white design shown in the existing preview.

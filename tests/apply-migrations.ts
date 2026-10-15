import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

// Runs once per isolated test worker. `applyD1Migrations` is idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);

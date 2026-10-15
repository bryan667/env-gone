import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const SPA_SHELL = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>';

// Tests run inside the real Workers runtime (workerd) with a real local D1
// database. The `ASSETS` binding is stubbed because assets are not needed to
// exercise the API and note-page routing behaviour under test.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-10-01',
        d1Databases: { DB: 'env-gone-test' },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('migrations'),
        },
        serviceBindings: {
          ASSETS: () =>
            new Response(SPA_SHELL, {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        },
      },
    })),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/apply-migrations.ts'],
  },
});

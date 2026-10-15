/**
 * Bindings available to the Worker. `Cloudflare.Env` is augmented so the
 * `cloudflare:workers` `env` export is typed in tests as well.
 */
export interface AppEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Test-only binding injected by the Vitest configuration. */
  TEST_MIGRATIONS?: Array<{ name: string; queries: string[] }>;
}

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

export type Env = Cloudflare.Env;

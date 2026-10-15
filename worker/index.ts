import type { Env } from './env';
import { handleRequest } from './handler';
import { purgeExpired } from './notes';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  /**
   * Scheduled cleanup. Exact expiry is enforced by the consume statement, so a
   * delayed sweep never makes an expired note readable.
   */
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      purgeExpired(env.DB, Math.floor(Date.now() / 1000))
        .then((deleted) => {
          console.log('purged_expired_notes', deleted);
        })
        .catch(() => {
          console.error('purge_failed');
        }),
    );
  },
} satisfies ExportedHandler<Env>;

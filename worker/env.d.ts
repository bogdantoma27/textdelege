declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/index");
  }
  interface Env {
    DATA: R2Bucket;
    DB: D1Database;
    ASSETS: Fetcher;
    /** Optional: absent in tests and in local dev without the binding. */
    MISS_LIMITER?: RateLimit;
    HEAVY_LIMITER?: RateLimit;
    SITE_HEAVY_LIMITER?: RateLimit;
    /** "off" refuses every heavy cache miss (see wrangler.toml). */
    HEAVY_ROUTES?: string;
    CF_VERSION_METADATA: { id: string; tag: string; timestamp: string };
  }
}

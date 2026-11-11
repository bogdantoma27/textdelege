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
    CF_VERSION_METADATA: { id: string; tag: string; timestamp: string };
  }
}

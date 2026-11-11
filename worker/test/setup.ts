import { env } from "cloudflare:test";
import { beforeAll, beforeEach, vi } from "vitest";
import { seedIndex, seedObjects } from "./seed";

beforeAll(async () => {
  await seedObjects(env);
  await seedIndex(env);
});

beforeEach(() => {
  const entries = new Map<string, { body: ArrayBuffer; status: number; headers: Headers }>();
  const url = (key: RequestInfo) => (typeof key === "string" ? key : key.url);
  const cache = {
    match: async (key: RequestInfo) => {
      const entry = entries.get(url(key));
      return entry && new Response(entry.body, { status: entry.status, headers: entry.headers });
    },
    put: async (key: RequestInfo, response: Response) => {
      entries.set(url(key), { body: await response.arrayBuffer(), status: response.status, headers: response.headers });
    },
    delete: async (key: RequestInfo) => entries.delete(url(key)),
  };
  vi.stubGlobal("caches", { default: cache, open: async () => cache });
});

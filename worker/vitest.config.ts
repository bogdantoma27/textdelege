import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // The suite sends hundreds of requests from one address; the limiters get their own tests.
      miniflare: {
        ratelimits: {
          MISS_LIMITER: { namespace_id: "7351", simple: { limit: 1_000_000, period: 60 } },
          HEAVY_LIMITER: { namespace_id: "7352", simple: { limit: 1_000_000, period: 60 } },
          SITE_HEAVY_LIMITER: { namespace_id: "7353", simple: { limit: 1_000_000, period: 60 } },
        },
      },
    })],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});

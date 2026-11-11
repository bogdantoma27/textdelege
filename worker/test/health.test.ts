import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { seedObjects } from "./seed";

describe("GET /healthz", () => {
  afterEach(() => seedObjects(env));

  it("healthz returns build and sourceHead", async () => {
    const response = await exports.default.fetch("https://example.com/healthz");
    expect(response.status).toBe(200);
    const body = await response.json<{ build: string; sourceHead: string }>();
    expect(body.build).toMatch(/^20261108T060000Z-[0-9a-f]{7}$/);
    expect(body.sourceHead).toMatch(/^[0-9a-f]{40}$/);
    expect(body.sourceHead.startsWith(body.build.slice(-7))).toBe(true);
  });

  it("healthz returns 503 without a manifest", async () => {
    await env.DATA.delete("manifest.json");
    const response = await exports.default.fetch("https://example.com/healthz");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "no_build" } });
  });
});

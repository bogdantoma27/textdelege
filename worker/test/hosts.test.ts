import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("other addresses of the site", () => {
  it("www leads to the canonical address with the path and query kept", async () => {
    const response = await exports.default.fetch("https://www.textdelege.ro/constitutia?pagina=2", { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://textdelege.ro/constitutia?pagina=2");
  });

  it("the canonical address is served", async () => {
    const response = await exports.default.fetch("https://textdelege.ro/healthz");
    expect(response.status).toBe(200);
  });
});

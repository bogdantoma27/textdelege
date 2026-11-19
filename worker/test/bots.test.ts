import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BLOCKED_BOTS, isBlockedBot } from "../src/lib/bots";

const get = (path: string, userAgent: string) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", headers: { "user-agent": userAgent } });

describe("isBlockedBot", () => {
  it("blocks the training crawlers, whatever the case", () => {
    for (const ua of [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
      "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Amazonbot/0.1)",
      "mozilla/5.0 (compatible; bytespider)",
      "CCBot/2.0 (https://commoncrawl.org/faq/)",
      "Mozilla/5.0 (compatible; Kangaroo Bot/1.0)",
    ]) {
      expect(isBlockedBot(ua), ua).toBe(true);
    }
    for (const name of BLOCKED_BOTS) expect(isBlockedBot(`x ${name.toUpperCase()}/1.0`), name).toBe(true);
  });

  it("lets search engines, AI search and user fetchers, link previews and browsers through", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
      "Mozilla/5.0 (compatible; DuckDuckBot/1.1)",
      "Mozilla/5.0 (compatible; YandexBot/3.0)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      "Claude-SearchBot",
      "Claude-User",
      "Mozilla/5.0 (compatible; PerplexityBot/1.0)",
      "Perplexity-User/1.0",
      "facebookexternalhit/1.1",
      "meta-externalfetcher/1.1",
      "WhatsApp/2.23",
      "LinkedInBot/1.0",
      "Twitterbot/1.0",
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 (compatible; Discordbot/2.0)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "",
    ]) {
      expect(isBlockedBot(ua), ua).toBe(false);
    }
    expect(isBlockedBot(null)).toBe(false);
    expect(isBlockedBot(undefined)).toBe(false);
  });
});

describe("blocked crawlers on the site", () => {
  it("get a small cacheable 403 on pages", async () => {
    const response = await get("/codul-civil/art-1", "Mozilla/5.0 (compatible; GPTBot/1.2)");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect((await response.text()).length).toBeLessThan(100);
  });

  it("can still read robots.txt, and allowed crawlers get the page", async () => {
    expect((await get("/robots.txt", "ClaudeBot/1.0")).status).toBe(200);
    expect((await get("/codul-civil", "Googlebot/2.1")).status).toBe(200);
    expect((await get("/codul-civil", "Claude-User")).status).toBe(200);
  });
});

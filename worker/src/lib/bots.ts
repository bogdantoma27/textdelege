/**
 * Crawlers that only collect training data and send no visitors. Search engines, AI search and user
 * fetchers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, meta-externalfetcher,
 * link-preview bots) are not here on purpose.
 */
export const BLOCKED_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "meta-externalagent",
  "FacebookBot",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "Omgilibot",
  "Timpibot",
  "ImagesiftBot",
  "PetalBot",
  "AI2Bot",
  "Ai2Bot-Dolma",
  "Kangaroo Bot",
  "PanguBot",
  "Google-CloudVertexBot",
] as const;

/** Training opt-out tokens: they do not crawl, they only appear in robots.txt. */
export const OPT_OUT_TOKENS = ["Google-Extended", "Applebot-Extended"] as const;

const LOWERED = BLOCKED_BOTS.map((name) => name.toLowerCase());

export function isBlockedBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const lowered = userAgent.toLowerCase();
  return LOWERED.some((name) => lowered.includes(name));
}

export const BLOCKED_BODY = "Forbidden: this crawler is not allowed. See /robots.txt.\n";

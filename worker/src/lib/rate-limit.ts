/** One bucket per IPv4 address and per IPv6 /64, as in the other Workers of the owner. */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** Misses on these paths do real work (search, comparisons, dated forms, list filters, sitemaps). */
export function isHeavy(pathname: string, search: string): boolean {
  if (pathname === "/cauta" || pathname === "/acte") return true;
  if (pathname.includes("/compara/")) return true;
  // A day in the address (an act or an article on a date, /legislatie/<date>) can be varied endlessly.
  if (/(?:^|\/)\d{4}-\d{2}-\d{2}$/.test(pathname)) return true;
  if (pathname === "/modificari" || pathname.startsWith("/modificari/")) return search !== "";
  if (pathname === "/legislatie" || pathname.startsWith("/legislatie/")) return true;
  return pathname.startsWith("/sitemap");
}

export const RETRY_AFTER = "60";

/** Every heavy miss counts against this one key, whoever asks. */
export const SITE_KEY = "all";

export const LIMITED = `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Temporar limitat | Textdelege</title></head><body><h1>Temporar limitat</h1><p>Căutarea, comparațiile și formele la o dată sunt limitate pentru o scurtă perioadă. Textul legilor rămâne disponibil: încearcă din nou peste un minut.</p><p><a href="/">Înapoi la prima pagină</a></p></body></html>`;

export const TOO_MANY = `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Prea multe cereri | Textdelege</title></head><body><h1>Prea multe cereri</h1><p>Ai trimis prea multe cereri într-un minut. Încearcă din nou peste un minut.</p></body></html>`;

export async function overLimit(limiter: RateLimit | undefined, ip: string, exact = false): Promise<boolean> {
  if (limiter === undefined) return false;
  try {
    const { success } = await limiter.limit({ key: exact ? ip : rateLimitKey(ip) });
    return !success;
  } catch (error) {
    console.error("rate limiter unavailable, letting the request through", error);
    return false;
  }
}

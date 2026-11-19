import { Hono } from "hono";
import { type DomainMonth, MONTH, domainActs, domainMonths } from "../lib/domain-changes";
import { type Domain, DOMAINS, findDomain } from "../lib/domains";
import type { AppEnv } from "../lib/store";
import { renderDomainIndex, renderDomainMonth, renderDomainPage } from "../views/domain-changes";

export const domainChangesRoutes = new Hono<AppEnv>();

domainChangesRoutes.get("/ce-s-a-schimbat", async (c) => {
  const store = c.get("store");
  const acts = await domainActs(store);
  const entries = await Promise.all(
    DOMAINS.map(async (domain) => [domain, await domainMonths(store, acts, domain)] as [Domain, DomainMonth[]]),
  );
  return c.html(renderDomainIndex(new Map(entries)));
});

domainChangesRoutes.get("/ce-s-a-schimbat/:domain/:year?/:month?", async (c) => {
  const domain = findDomain(c.req.param("domain"));
  if (domain === undefined) return c.notFound();
  const { year, month } = c.req.param();
  if ((year === undefined) !== (month === undefined)) return c.notFound();
  const store = c.get("store");
  const months = await domainMonths(store, await store.actsByPath(domain.acts), domain);
  if (year === undefined || month === undefined) {
    return months.length === 0 ? c.notFound() : c.html(renderDomainPage(domain, months));
  }
  const key = `${year}-${month}`;
  if (!/^\d{4}$/.test(year) || !MONTH.test(key)) return c.notFound();
  const at = months.findIndex((item) => item.month === key);
  const data = months[at];
  if (data === undefined) return c.notFound();
  return c.html(
    renderDomainMonth(domain, data, {
      previous: months[at + 1]?.month ?? null,
      next: months[at - 1]?.month ?? null,
    }),
  );
});

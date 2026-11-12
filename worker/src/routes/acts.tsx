import { Hono } from "hono";
import { pageNumber } from "../lib/act";
import { listFromIndex } from "../lib/act-list";
import type { AppEnv } from "../lib/store";
import { KINDS } from "../views/shared";
import { type ActsQuery, MAX_TEXT, STATUS_PARAMS, renderActs } from "../views/acts";

export const actsRoutes = new Hono<AppEnv>();

const YEAR = /^[0-9]{4}$/;

actsRoutes.get("/acte", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const tip = params.get("tip") ?? "";
  const stare = params.get("stare") ?? "";
  const year = (params.get("an") ?? "").trim();
  const query: ActsQuery = {
    kind: KINDS.find((kind) => kind === tip) ?? null,
    year,
    status: (Object.keys(STATUS_PARAMS) as (keyof typeof STATUS_PARAMS)[]).find((key) => key === stare) ?? null,
    q: (params.get("q") ?? "").trim().slice(0, MAX_TEXT).trim(),
    yearInvalid: year !== "" && !YEAR.test(year),
  };
  const filter = {
    kind: query.kind ?? undefined,
    year: year === "" ? undefined : Number(year),
    status: query.status === null ? undefined : STATUS_PARAMS[query.status],
    q: query.q,
    page: pageNumber(params.get("pagina")),
  };
  const store = c.get("store");
  const list = query.yearInvalid
    ? { items: [], total: 0, over: false, page: 1, pages: 1 }
    : await store.listActs(filter).catch(async () => listFromIndex(await store.actIndex(), filter));
  return c.html(renderActs(query, list), query.yearInvalid ? 400 : 200);
});

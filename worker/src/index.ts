import { Hono } from "hono";
import { pageCache, securityHeaders } from "./lib/http";
import { withSources } from "./lib/outages";
import { type AppEnv, NoBuildError, withStore } from "./lib/store";
import { actRoutes } from "./routes/act";
import { articleRoutes } from "./routes/article";
import { changesRoutes } from "./routes/changes";
import { compareRoutes } from "./routes/compare";
import { helpRoutes } from "./routes/help";
import { homeRoutes } from "./routes/home";
import { lawRoutes } from "./routes/law";
import { pointInTimeRoutes } from "./routes/pointInTime";
import { rulingRoutes } from "./routes/ruling";
import { searchRoutes } from "./routes/search";
import { errorHandler, notFoundHandler, siteRoutes } from "./routes/site";
import { ORIGIN } from "./views/layout";

const app = new Hono<AppEnv>();
const HOST = new URL(ORIGIN).host;

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.host === `www.${HOST}`) {
    return c.redirect(`${ORIGIN}${url.pathname}${url.search}`, 301);
  }
  await next();
});

const FILTERED = /^\/(?:modificari|abonare|cauta)(?:\/|$)/;

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (c.req.method === "GET" && url.search !== "" && FILTERED.test(url.pathname)) {
    const params = new URLSearchParams(url.search);
    const kept = new URLSearchParams([...params].filter(([, value]) => value !== ""));
    if ([...kept].length < [...params].length) {
      const query = kept.toString();
      return c.redirect(`${url.pathname}${query === "" ? "" : `?${query}`}`, 301);
    }
  }
  await next();
});

app.use("*", securityHeaders);
app.use("*", withStore);
app.use("*", pageCache);

app.get("/healthz", async (c) => {
  try {
    const manifest = await c.get("store").manifest();
    return c.json({ build: manifest.build, sourceHead: manifest.source_head });
  } catch (error) {
    if (error instanceof NoBuildError) {
      return c.json({ error: { code: "no_build" } }, 503);
    }
    throw error;
  }
});

app.use("*", async (c, next) => {
  const manifest = await c.get("store").manifest().catch(() => null);
  await withSources(manifest?.status?.official_sources ?? [], next, manifest?.generated?.slice(0, 10) ?? null);
});

app.route("/", siteRoutes);
app.route("/", homeRoutes);
app.route("/", searchRoutes);
app.route("/", changesRoutes);
app.route("/", articleRoutes);
app.route("/", compareRoutes);
app.route("/", rulingRoutes);
app.route("/", pointInTimeRoutes);
app.route("/", helpRoutes);
app.route("/", actRoutes);
app.route("/", lawRoutes);
app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;

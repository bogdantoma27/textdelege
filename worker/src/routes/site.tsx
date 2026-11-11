import type { Context } from "hono";
import { type AppEnv, NoBuildError } from "../lib/store";
import { NotFound } from "../views/not-found";
import { Unavailable } from "../views/unavailable";

export function notFoundHandler(c: Context<AppEnv>) {
  return c.html(<NotFound path={c.req.path} />, 404);
}

function isStorageFailure(error: unknown): boolean {
  if (error instanceof NoBuildError) return true;
  return error instanceof Error && /\b(D1_[A-Z_]+|R2)\b/.test(error.message);
}

const RETRY_AFTER = "120";

export function errorHandler(error: Error, c: Context<AppEnv>) {
  const page = <Unavailable path={c.req.path} />;
  if (!isStorageFailure(error)) {
    console.error("unhandled error", c.req.path, error);
    return c.html(page, 500);
  }
  console.error("data store unavailable", c.req.path, error);
  c.header("Retry-After", RETRY_AFTER);
  return c.html(page, 503);
}

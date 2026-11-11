import { env } from "cloudflare:test";

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function replaceObject(key: string, value: unknown): Promise<() => Promise<void>> {
  const original = await env.DATA.get(key);
  const bytes = original === null ? null : await original.arrayBuffer();
  await env.DATA.put(key, await gzip(JSON.stringify(value)));
  return async () => {
    if (bytes === null) await env.DATA.delete(key);
    else await env.DATA.put(key, bytes);
  };
}

export async function removeObject(key: string): Promise<() => Promise<void>> {
  const original = await env.DATA.get(key);
  const bytes = original === null ? null : await original.arrayBuffer();
  await env.DATA.delete(key);
  return async () => {
    if (bytes !== null) await env.DATA.put(key, bytes);
  };
}

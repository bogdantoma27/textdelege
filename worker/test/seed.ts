const objects = import.meta.glob("./fixtures/dataset/**/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const indexSql = Object.values(
  import.meta.glob("./fixtures/dataset/index.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)[0];

const PREFIX = "./fixtures/dataset/";

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function seedObjects(env: Cloudflare.Env): Promise<void> {
  for (const [path, text] of Object.entries(objects)) {
    await env.DATA.put(path.slice(PREFIX.length), await gzip(text), {
      httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
    });
  }
}

export async function seedIndex(env: Cloudflare.Env): Promise<void> {
  const statements = (indexSql ?? "").split(";\n").filter((sql) => sql.trim() !== "");
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
}

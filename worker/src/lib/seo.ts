export function plainText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateAtWord(text: string, max: number): string {
  const flat = plainText(text);
  if (flat.length <= max) return flat;
  const room = Math.max(max - 1, 0);
  const cut = flat.slice(0, room + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > room / 2 ? cut.slice(0, space) : flat.slice(0, room)).replace(/[\s,;:.\-–—(]+$/, "");
  return `${head}…`;
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

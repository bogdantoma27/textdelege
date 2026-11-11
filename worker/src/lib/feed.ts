export interface FeedEntry {
  id: string;
  title: string;
  updated: string;
  link: string;
  summary: string;
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function escapeXml(value: string): string {
  return value.replace(ILLEGAL, "").replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

type Attributes = Record<string, string>;

function open(name: string, attributes: Attributes): string {
  const pairs = Object.entries(attributes).map(([key, value]) => ` ${key}="${escapeXml(value)}"`);
  return `<${name}${pairs.join("")}`;
}

function leaf(name: string, text: string, attributes: Attributes = {}): string {
  return `${open(name, attributes)}>${escapeXml(text)}</${name}>`;
}

function node(name: string, children: string[], attributes: Attributes = {}): string {
  return `${open(name, attributes)}>${children.join("")}</${name}>`;
}

function empty(name: string, attributes: Attributes): string {
  return `${open(name, attributes)}/>`;
}

export function tagId(path: string): string {
  return `tag:textdelege.ro,2026:${path}`;
}

function alternateOf(self: string): string {
  return self.replace(/\.atom(?=\?|$)/, "");
}

export function atom(
  entries: FeedEntry[],
  self: string,
  title: string,
  fallbackUpdated: string,
  newest: string = entries.reduce((max, entry) => (entry.updated > max ? entry.updated : max), ""),
): string {
  const url = new URL(self);
  const path = url.pathname.slice(1) + url.search;
  const feed = node(
    "feed",
    [
      leaf("id", tagId(path)),
      leaf("title", title),
      leaf("updated", newest === "" ? fallbackUpdated : newest),
      empty("link", { rel: "self", type: "application/atom+xml", href: self }),
      empty("link", { rel: "alternate", type: "text/html", href: alternateOf(self) }),
      node("author", [leaf("name", "Textdelege")]),
      ...entries.map((entry) =>
        node("entry", [
          leaf("id", entry.id),
          leaf("title", entry.title),
          leaf("updated", entry.updated),
          empty("link", { rel: "alternate", type: "text/html", href: entry.link }),
          leaf("summary", entry.summary, { type: "text" }),
        ]),
      ),
    ],
    { xmlns: "http://www.w3.org/2005/Atom" },
  );
  return `<?xml version="1.0" encoding="utf-8"?>${feed}`;
}

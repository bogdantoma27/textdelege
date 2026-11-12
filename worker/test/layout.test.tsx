import { describe, expect, it } from "vitest";
import { withSources } from "../src/lib/outages";
import type { OfficialSource } from "../src/lib/types";
import { Layout, SCRIPTED_SPECULATION_RULES, SPECULATION_RULES } from "../src/views/layout";

const source = (name: string, state: OfficialSource["state"], since: string | null): OfficialSource => ({
  name,
  state,
  unavailable_since: since,
  last_successful_contact: "2026-11-01T08:00:00Z",
  as_of: "2026-11-08T08:56:56Z",
});

const render = (props: Partial<Parameters<typeof Layout>[0]> = {}) =>
  String(
    <Layout
      title="Art. 1112"
      canonical="https://textdelege.ro/codul-civil/art-1112"
      {...props}
    >
      <p>body</p>
    </Layout>,
  );

describe("Layout", () => {
  it("sets the language, title and canonical link", () => {
    const html = render({ description: "About" });
    expect(html).toContain('<html lang="ro"');
    expect(html).toContain("<title>Art. 1112 | Textdelege</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://textdelege.ro/codul-civil/art-1112"',
    );
    expect(html).toContain('<meta name="description" content="About"');
  });

  it("loads speculative navigation rules that skip the health check and the feeds", () => {
    const html = render();
    const body = /<script type="speculationrules">(.*?)<\/script>/s.exec(html)?.[1];
    expect(body).toBeDefined();
    const rules = JSON.parse(body!);
    expect(rules).toEqual(JSON.parse(SPECULATION_RULES));
    expect(rules.prerender[0].eagerness).toBe("moderate");
    expect(rules.prefetch[0].eagerness).toBe("conservative");
    const where = JSON.stringify(rules.prerender[0].where);
    for (const excluded of ["/healthz", "/*.xml", "/*.atom", "[rel~=nofollow],[download]"]) {
      expect(where).toContain(excluded);
    }
  });

  it("keeps the links of the content out of the prerender rules on the pages whose script loads them in place", () => {
    const rules = (html: string) => /<script type="speculationrules">(.*?)<\/script>/s.exec(html)?.[1];
    expect(rules(render({ script: "/article.js" }))).toBe(SCRIPTED_SPECULATION_RULES);
    expect(SCRIPTED_SPECULATION_RULES).toContain("#page a");
    expect(rules(render())).toBe(SPECULATION_RULES);
    expect(SPECULATION_RULES).not.toContain("#page a");
  });

  it("loads the enhancement module", () => {
    expect(render()).toContain('<script type="module" src="/site.js">');
  });

  it("renders the phone search overlay with its own field and a close link", () => {
    const html = render({ query: "civil" });
    expect(html).toContain('<a class="find" href="#cauta"');
    const overlay = html.slice(html.indexOf('id="cauta"'));
    expect(overlay).toContain('class="scrim" href="#"');
    expect(overlay).toContain('role="search" action="/cauta" method="get"');
    expect(overlay).toContain('id="q-overlay"');
    expect(overlay).toContain('name="q"');
    expect(overlay).toContain('<a class="close" href="#">');
    expect(overlay).toContain("Închide");
  });

  it("puts the skip link first among focusable elements and targets the main slot", () => {
    const html = render();
    const first = /<(?:a|button|input)\b[^>]*>/.exec(html);
    expect(first?.[0]).toContain('class="skip"');
    expect(first?.[0]).toContain('href="#main"');
    expect(html).toContain('<main id="main" tabindex="-1">');
  });

  it("keeps the footer out of the main landmark and the contents after the text", () => {
    const html = render({
      toc: <div class="toc-sheet">contents</div>,
      rail: <aside class="rail">rail</aside>,
    });
    expect(html).toContain('<div class="wrap shell" id="page"><main id="main" tabindex="-1">');
    const order = ["<main", "</main>", 'class="toc-sheet"', 'class="rail"', "<footer"].map((part) => html.indexOf(part));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.indexOf('<div class="search-overlay"')).toBeLessThan(html.indexOf('<main'));
  });

  it("keeps the breadcrumbs and the text inside main", () => {
    const html = render();
    expect(html).toMatch(/<main id="main" tabindex="-1"><p>body<\/p><\/main>/);
  });

  it("emits a noindex meta only when requested", () => {
    expect(render()).not.toContain("noindex");
    expect(render({ noindex: true })).toContain('<meta name="robots" content="noindex"');
  });

  it("renders no banner of its own: the dated note belongs to the pages that have a date", () => {
    const html = render();
    expect(html).not.toContain("banner");
    expect(html).not.toContain("notification");
  });

  it("marks the header link of the current section, on its own page and inside the section", () => {
    const at = (canonical: string, toc?: boolean) =>
      render({ canonical, toc: toc ? <div class="toc-sheet" /> : undefined });
    const nav = (html: string) => /<nav class="nav"[^>]*>([\s\S]*?)<details class="display">/.exec(html)?.[1] ?? "";
    expect(nav(at("https://textdelege.ro/"))).toContain('<a href="/#coduri" aria-current="page" data-text="Coduri">Coduri</a>');
    expect(nav(at("https://textdelege.ro/codul-civil/art-1", true))).toContain('<a href="/#coduri" aria-current="true" data-text="Coduri">');
    expect(nav(at("https://textdelege.ro/modificari"))).toContain('<a href="/modificari" aria-current="page" data-text="Modificări">');
    expect(nav(at("https://textdelege.ro/modificari/codul-civil"))).toContain('<a href="/modificari" aria-current="true" data-text="Modificări">');
    const other = nav(at("https://textdelege.ro/despre"));
    expect(other).not.toContain("aria-current");
    expect(nav(at("https://textdelege.ro/modificari"))).not.toContain('<a href="/#coduri" aria-current');
    expect(at("https://textdelege.ro/modificari").match(/aria-current="page"/g)).toHaveLength(2);
  });

  it("keeps the citation of the page for print, with the build day when it is known", () => {
    const cite = { sentence: "Art. 1 Codul civil, în vigoare la 11.11.2026", address: "https://textdelege.ro/codul-civil/art-1/2023-07-09" };
    expect(render()).not.toContain("print-cite");
    const html = withSources([], () => render({ cite }), "2026-11-10");
    expect(html).toContain(
      '<div class="print-cite"><p>Art. 1 Codul civil, în vigoare la 11.11.2026</p><p>https://textdelege.ro/codul-civil/art-1/2023-07-09</p><p>Pagină generată la 10.11.2026</p></div></main>',
    );
    expect(render({ cite })).not.toContain("Pagină generată");
  });

  it("posts the omnibox to the search page with the current query", () => {
    const html = render({ query: 'art. "1112"' });
    const form = /<form[^>]*role="search"[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('action="/cauta"');
    expect(form).toContain('method="get"');
    expect(html).toMatch(/<input[^>]*name="q"/);
    expect(html).toContain("art. &quot;1112&quot;");
    expect(html).not.toContain("<kbd");
  });

  it("labels the all-results link of the live search on both search forms", () => {
    expect(render().match(/<form[^>]*role="search"[^>]*data-all="Toate rezultatele"/g)).toHaveLength(2);
  });

  it("carries the message for an empty search on both search forms", () => {
    expect(render().match(/<form[^>]*role="search"[^>]*data-empty="Scrie ce cauți\."/g)).toHaveLength(2);
  });

  it("links the stylesheet, preloads the variable fonts and marks the page as scripted before paint", () => {
    const html = render();
    expect(html).toContain('<link rel="stylesheet" href="/styles.css"');
    expect(html).toContain(
      '<link rel="preload" href="/fonts/ibm-plex-sans-var.woff2" as="font" type="font/woff2" crossorigin=""',
    );
    expect(html).toContain(
      '<link rel="preload" href="/fonts/source-serif-4-var.woff2" as="font" type="font/woff2" crossorigin=""',
    );
    expect(html).toContain('<link rel="preload" href="/fonts/caveat-wordmark.woff2" as="font"');
    expect(html.match(/rel="preload"/g)).toHaveLength(4);
    expect(html).toContain('if(navigator.clipboard)r.classList.add("clip");');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script.startsWith('document.documentElement.classList.add("js");')).toBe(true);
    expect(script).toContain("tdl.settings");
    expect(script).toContain("try");
    expect(new TextEncoder().encode(script).length).toBeLessThanOrEqual(1024);
  });

  it("targets the defined pages in the header and the footer", () => {
    const html = render();
    for (const href of ["/#coduri", "/modificari", "https://github.com/lexifina/romania-law", "/despre", "/legenda", "/legislatie", "/cauta"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).not.toContain("viitoare");
  });

  it("carries the display menu in the masthead and in the phone menu, in separate groups", () => {
    const html = render();
    const menus = html.match(/<details class="display">[\s\S]*?<\/details>/g) ?? [];
    expect(menus).toHaveLength(2);
    const [bar, phone] = menus as [string, string];
    expect(bar).toContain("<summary>Opțiuni</summary>");
    expect(bar).toContain('<input type="radio" name="bar-theme" value="auto" checked=""/>Ca sistemul');
    expect(bar).toContain('<input type="radio" name="bar-theme" value="dark"/>Închisă');
    expect(bar).toContain('<input type="radio" name="bar-size" value="19" checked="" aria-label="Text de 19 pixeli"/>');
    expect(bar).toMatch(/<input type="radio" name="bar-size" value="15"[^>]*aria-label="Text de 15 pixeli"/);
    expect(bar).not.toMatch(/<label[^>]*aria-label/);
    expect(bar).not.toContain("checkbox");
    expect(phone).toContain('name="menu-theme"');
    expect(html.indexOf('class="menu"')).toBeLessThan(html.indexOf(phone));
  });

  it("offers a no-JavaScript menu with navigation", () => {
    const html = render();
    const menu = /<details class="menu">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "";
    expect(menu).toContain("<summary>Meniu</summary>");
    expect(menu).toContain('href="/#coduri"');
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks the home page on the body and keeps the masthead search there too", () => {
    const html = render({ home: true });
    expect(html.match(/type="search"/g)).toHaveLength(2);
    expect(html).toContain('<body class="home">');
  });

  it("keeps one header search field and one in the overlay that the phone button opens", () => {
    const html = render();
    expect(html.match(/type="search"/g)).toHaveLength(2);
    expect(html).toContain('<a class="find" href="#cauta">Caută</a>');
    expect(html.match(/ id="q"/g)).toHaveLength(1);
    expect(html.match(/ id="cauta"/g)).toHaveLength(1);
    expect(html).toContain('<label class="vh" for="q">Căutare</label>');
    expect(html.match(/<button class="search-button" type="submit"><svg [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg><span class="vh">Caută<\/span><\/button>/g)).toHaveLength(2);
  });

  it("scopes the site chrome with classes", () => {
    const html = render();
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('<footer class="site-footer" id="sfarsit">');
  });

  it("sets the footer in three columns, the independence statement and the licence", () => {
    const html = render();
    const footer = html.slice(html.indexOf('<footer class="site-footer" id="sfarsit">'));
    expect(footer.match(/<div class="footer-col">/g)).toHaveLength(3);
    expect(footer.match(/<h2>[^<]+<\/h2>/g)).toEqual(["<h2>Explorează</h2>", "<h2>Date</h2>", "<h2>Despre</h2>"]);
    const links = [...footer.matchAll(/<li><a href="([^"]+)">/g)].map((m) => m[1]);
    expect(links).toEqual([
      "/#coduri",
      "/acte",
      "/modificari",
      "/legislatie",
      "/cauta",
      "/abonare",
      "https://github.com/lexifina/romania-law",
      "https://github.com/bogdantoma27/textdelege",
      "/despre#licenta",
      "/despre",
      "/legenda",
      "/despre#actualitate",
      "/despre#contact",
      "https://ko-fi.com/bogdantoma27",
    ]);
    expect(footer).toContain("Sursa datelor pe GitHub<svg");
    expect(footer).toContain("Codul site-ului pe GitHub<svg");
    expect(footer).toContain('<a href="https://ko-fi.com/bogdantoma27">Susține-mă cu o cafea<svg');
    expect(footer).not.toContain('class="btn');
    expect(footer).toContain('<a href="/despre#contact">Contact</a>');
    expect(footer).toContain("Despre Textdelege</a>");
    expect(footer).toMatch(/<a class="to-bottom" href="#sfarsit"><svg[^>]*>[\s\S]*?<\/svg><span>Derulează la sfârșit<\/span><\/a>/);
    expect(footer).toMatch(/<a class="to-top" href="#"><svg[^>]*>[\s\S]*?<\/svg><span>Înapoi sus<\/span><\/a>/);
    expect(footer).not.toMatch(/class="to-(top|bottom)"[^>]*(aria-label|title)=/);
    expect(footer).toContain(
      '<p class="footer-text">Textdelege este un site independent, nu un serviciu public. Textele oficiale sunt cele publicate în Monitorul Oficial.</p>',
    );
    expect(footer).toContain(
      '<p class="footer-licence">Textele legilor nu sunt protejate de dreptul de autor (Legea nr. 8/1996, art. 9 lit. b). Datele sunt sub licența CC0, codul site-ului sub licența MIT.</p>',
    );
    expect(footer.indexOf('class="footer-licence"')).toBeLessThan(footer.indexOf('class="footer-nav"'));
  });

  it("never puts a verification date or a source outage into the footer line", () => {
    const down = withSources([source("Portal (legislatie.just.ro)", "unavailable", "2026-11-08T08:52:13Z")], render);
    for (const html of [render(), down]) {
      const footer = html.slice(html.indexOf('<footer class="site-footer"'));
      expect(footer.match(/<p class="footer-text">/g)).toHaveLength(1);
      const line = /<p class="footer-text">([\s\S]*?)<\/p>/.exec(footer)?.[1] ?? "";
      expect(line).toMatch(/Monitorul Oficial\.$/);
      expect(line).not.toMatch(/verific|nu răspunde|<span|<a /);
      expect(footer).not.toContain("nu răspunde");
    }
  });

  it("names the product Textdelege in the title and draws the logo before the wordmark twice", () => {
    const html = render();
    expect(html).toContain("<title>Art. 1112 | Textdelege</title>");
    expect(html.match(/<a class="brand" href="\/"><svg width="\d+" height="\d+" viewBox="0 0 44 44" aria-hidden="true" focusable="false">[\s\S]*?<\/svg><span>Textdelege<\/span><\/a>/g)).toHaveLength(2);
    const header = html.slice(html.indexOf('<header class="site-header">'), html.indexOf("</header>"));
    expect(header).toContain('<rect x="6" y="5" width="32" height="34" rx="2" fill="#ffffff"');
    expect(html.slice(html.indexOf("<footer"))).toContain('<rect x="6" y="5" width="32" height="34" rx="2" fill="#0b2a6b"');
  });

  it("widens the page for the contents list only when asked, with the short footer", () => {
    expect(render()).toContain("<body>");
    expect(render()).toContain('<footer class="site-footer" id="sfarsit">');
    const contents = render({ toc: <div class="toc-sheet" /> });
    expect(contents).toContain('<body class="with-contents">');
    expect(contents).toContain('<footer class="site-footer compact" id="sfarsit">');
    expect(contents).not.toContain("footer-licence");
  });

  it("links the favicon", () => {
    expect(render()).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"');
  });

  it("shows no source outage text anywhere on the page", () => {
    const html = withSources([source("legislatie.just.ro", "unavailable", "2026-11-05T10:00:00Z")], render);
    expect(html).not.toContain("nu răspunde");
    expect(render()).not.toContain("nu răspunde");
  });
});

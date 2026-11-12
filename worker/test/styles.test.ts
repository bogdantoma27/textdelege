import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import headers from "../public/_headers?raw";

const css = await (await env.ASSETS.fetch("https://assets.test/styles.css")).text();
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

const base = (source: string) =>
  source
    .replace(/max\((\d+(?:\.\d+)?px),calc\(\1\*var\(--k\)\)\)/g, "$1")
    .replace(/calc\((\d+(?:\.\d+)?px)\*var\(--k\)\)/g, "$1");

function block(selector: string, source = css): string {
  for (let start = source.indexOf(`${selector}{`); start !== -1; start = source.indexOf(`${selector}{`, start + 1)) {
    const before = source.slice(0, start).replace(/ +$/, "");
    if (before === "" || /[\n{}]$/.test(before)) return base(source.slice(start, source.indexOf("}", start)));
  }
  return "";
}

function media(query: string): string {
  const bodies: string[] = [];
  for (let start = css.indexOf(`@media ${query}{`); start !== -1; start = css.indexOf(`@media ${query}{`, start + 1)) {
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        bodies.push(base(css.slice(start, i + 1)));
        break;
      }
    }
  }
  return bodies.join("\n");
}

const light = block(":root");
const dark = block(':root[data-theme="dark"]');
const auto = block(':root:not([data-theme="light"])');
const phone = media("(max-width:640px)");
const narrow = media("(max-width:1100px)");
const coarse = media("(pointer:coarse)");

const LIGHT: Record<string, string> = {
  text: "#1a1a1a",
  secondary: "#4a4a4a",
  muted: "#6b6761",
  page: "#f5f3ee",
  paper: "#ffffff",
  surface: "#ede9e0",
  "surface-2": "#e4dfd4",
  border: "#e2ddd3",
  "border-strong": "#8f8778",
  mast: "#0b2a6b",
  "on-mast": "#ffffff",
  brand: "#0b2a6b",
  "brand-hover": "#061b4a",
  "brand-tint": "#e6ebf7",
  "brand-tint-2": "#cdd7ef",
  accent: "#f2c230",
  "accent-tint": "#fbefc9",
  "accent-text": "#5c4300",
  danger: "#b8121f",
  "danger-tint": "#f9e2e4",
  success: "#1f7a3f",
  "success-tint": "#e1f2e6",
  "diff-del": "#8f0c18",
  "diff-del-bg": "#fbe3e6",
  "diff-ins": "#12562d",
  "diff-ins-bg": "#e3f3e9",
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("styles.css", () => {
  it("never animates between pages and turns every transition off under reduced motion", () => {
    expect(css).not.toContain("view-transition");
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{transition:none!important;animation:none!important/);
  });

  it("changes backgrounds on hover only where hovering exists", () => {
    const disabled = block(".btn:disabled,.btn:disabled:hover,.btn.secondary:disabled:hover");
    expect(disabled).toBe(
      ".btn:disabled,.btn:disabled:hover,.btn.secondary:disabled:hover{border-color:var(--border);background:var(--surface);color:var(--muted);cursor:not-allowed",
    );
    const outside = css.replace(/@media \(hover:hover\)\{[^{}]*\{[^{}]*\}\}/g, "").replace(/\.btn:disabled,[^{}]*\{[^{}]*\}/, "");
    for (const line of outside.split(/\r?\n/)) {
      expect(line).not.toMatch(/:hover[^{]*\{[^}]*(background|box-shadow)/);
    }
  });

  it("dims and blurs the page behind the search panel, with a plain dim where blur is unsupported", () => {
    expect(css).toContain("@supports (backdrop-filter:blur(6px)){.search-overlay .scrim{background:rgb(22 22 22/.35);backdrop-filter:blur(6px)}}");
    expect(block(".search-overlay .scrim")).toContain("background:rgb(22 22 22/.6)");
    const sheet = block(".search-overlay .sheet");
    expect(sheet).toContain("background:var(--paper)");
    expect(sheet).toContain("border-radius:4px");
    expect(sheet).toContain("box-shadow:0 8px 24px rgb(0 0 0/.16)");
    expect(css).toContain("html:has(.search-overlay:target,.search-overlay.open){overflow:hidden}");
  });

  it("shows live search results in a panel under the masthead field and inside the phone sheet", () => {
    expect(block(".omni")).toContain("position:relative");
    const panel = block(":is(.header-bar,.page-search) .search-results");
    for (const part of ["position:absolute", "top:calc(100% + 8px)", "z-index:25", "max-height:70vh", "overflow:auto", "background:var(--paper)", "color:var(--text)", "box-shadow:0 8px 24px rgb(0 0 0/.16)"]) {
      expect(panel, part).toContain(part);
    }
    expect(block(".search-results[hidden]")).toContain("display:none");
    expect(block(".search-results .hits li")).toContain("padding:12px 0");
    expect(block(".search-overlay .search-results")).toContain("max-height:calc(100dvh - 120px)");
    expect(block('.search-results .hits [aria-selected="true"]')).toContain("outline:2px solid var(--brand)");
    expect(block(".search-results .hits li.search-all")).toContain("border-bottom:0");
  });

  it("shows the message of an empty search in a panel that takes no space", () => {
    const hint = block(".search-hint");
    for (const part of ["position:absolute", "top:calc(100% + 8px)", "background:var(--paper)", "color:var(--text)"]) expect(hint, part).toContain(part);
    expect(block(".search-hint:empty")).toContain("display:none");
    expect(block(".page-search")).toContain("max-width:560px");
  });

  it("defines every colour token in the light, dark and automatic blocks", () => {
    for (const name of [...Object.keys(LIGHT), "on-brand"]) {
      expect(light, "light " + name).toContain("--" + name + ":");
      expect(dark, "dark " + name).toContain("--" + name + ":");
      expect(auto, "auto " + name).toContain("--" + name + ":");
    }
  });

  it("uses the light colours of the design system", () => {
    const expected = LIGHT;
    for (const [name, value] of Object.entries(expected)) {
      expect(light, name).toContain("--" + name + ":" + value + ";");
    }
  });

  it("uses the dark colours of the design system in both dark blocks, with the masthead unchanged", () => {
    const expected: Record<string, string> = {
      text: "#e6e3dc",
      secondary: "#c4c0b8",
      muted: "#9a958c",
      page: "#141414",
      paper: "#1d1d1d",
      surface: "#262626",
      "surface-2": "#303030",
      border: "#383838",
      "border-strong": "#7d7a74",
      mast: "#0b2a6b",
      "on-mast": "#ffffff",
      brand: "#9db4f0",
      "brand-hover": "#bccbf5",
      "brand-tint": "#1f2a4a",
      "brand-tint-2": "#2b3a66",
      "on-brand": "#141414",
      accent: "#f2c230",
      danger: "#ff6b7a",
      "danger-tint": "#4a1a20",
      success: "#6fcf97",
      "success-tint": "#153a24",
      "diff-del": "#ffb3bb",
      "diff-del-bg": "#4a1a20",
      "diff-ins": "#9fe0b8",
      "diff-ins-bg": "#153a24",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(dark, name).toContain("--" + name + ":" + value + ";");
      expect(auto, name).toContain("--" + name + ":" + value + ";");
    }
    expect(dark.slice(dark.indexOf("{"))).toBe(auto.slice(auto.indexOf("{")).replace(/\n {2}/g, "\n"));
  });

  it("defines the eight law bar hues in every theme block", () => {
    for (const [theme, source] of [["light", light], ["dark", dark], ["auto dark", auto]] as const) {
      for (let n = 1; n <= 8; n++) {
        expect(source, theme + " --b" + n).toMatch(new RegExp(String.raw`--b${n}:#[0-9a-f]{6}`));
      }
    }
  });

  it("keeps text at 4.5:1 and control borders at 3:1 in every theme", () => {
    for (const [theme, source] of [["light", light], ["dark", dark], ["auto dark", auto]] as const) {
      const token = (name: string) => new RegExp(String.raw`--${name}:(#[0-9a-f]{6})`).exec(source)![1]!;
      const grounds = [token("page"), token("paper"), token("surface"), token("surface-2")];
      const pairs: [string, string[]][] = [
        ["text", [...grounds, token("brand-tint")]],
        ["secondary", [...grounds, token("brand-tint")]],
        ["muted", [token("page"), token("paper")]],
        ["brand", [...grounds, token("brand-tint"), token("brand-tint-2")]],
        ["brand-hover", [token("page"), token("paper")]],
        ["on-brand", [token("brand"), token("brand-hover")]],
        ["on-mast", [token("mast")]],
        ["danger", [token("page"), token("paper"), token("surface"), token("danger-tint")]],
        ["success", [token("paper"), token("page")]],
        ["accent-text", [token("paper"), token("page"), token("accent-tint")]],
        ["diff-del", [token("diff-del-bg")]],
        ["diff-ins", [token("diff-ins-bg")]],
      ];
      for (const [name, backgrounds] of pairs) {
        for (const background of backgrounds) {
          expect(ratio(token(name), background), theme + " " + name + " on " + background).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(ratio(token("border-strong"), token("paper")), theme + " control border").toBeGreaterThanOrEqual(3);
      expect(ratio(token("accent"), token("mast")), theme + " gold rule on the masthead").toBeGreaterThanOrEqual(3);
    }
  });

  it("rounds corners to 4 px, except the round markers, the scrollbar thumbs and the calendar button", () => {
    const radii = [...rules.matchAll(/([^{}]+)\{[^{}]*border-radius:([^;}]+)/g)].map((m) => [m[1]!.trim().split("\n").pop()!, m[2]!.trim()] as [string, string]);
    expect(radii.length).toBeGreaterThan(8);
    for (const [selector, value] of radii) {
      if ([".pt", ".pt::before"].includes(selector)) expect(value).toBe("50%");
      else if (selector.endsWith("::-webkit-scrollbar-thumb")) expect(value).toBe(selector === "html::-webkit-scrollbar-thumb" ? "6px" : "3px");
      else if (selector === ".date-open") expect(value).toBe("0 3px 3px 0");
      else if ([".home-search .search-button", ".pt,.pt.cur,.pt.rng"].includes(selector)) expect(value).toBe("0");
      else expect(value, selector).toBe("4px");
    }
    for (const selector of [".field", ".btn", ".toc-list>a", ".search-overlay .sheet", ".header-bar>.omni"]) {
      expect(radii.some(([name]) => name === selector), selector).toBe(true);
    }
    expect(block(".data th") + block(".inset,.warning") + block(".badge")).not.toContain("border-radius");
    expect(rules.replace(/mask-image:[^;}]+/g, "")).not.toMatch(/gradient\(/);
    expect(rules).not.toContain("border-radius:999");
  });

  it("sets the interface in Plex Sans, headings and law text in Source Serif, the wordmark alone in Caveat", () => {
    expect(light).toContain('--font:"IBM Plex Sans","IBM Plex Sans Fallback",system-ui,"Segoe UI",Roboto,sans-serif;');
    expect(light).toContain('--serif:"Source Serif 4","Source Serif 4 Fallback","Source Serif 4 Fallback Times",Georgia,"Times New Roman",serif;');
    expect(light).toContain('--hand:"Caveat",cursive;');
    expect(light).toContain("--mono:ui-monospace,Menlo,Consolas,monospace;");
    expect(block("body")).toContain("font-family:var(--font)");
    expect(block("h1,h2,h3")).toContain("font-family:var(--serif)");
    expect(block(".law")).toContain("font-family:var(--serif)");
    expect(block(".brand span")).toContain("font-family:var(--hand)");
    const families = [...rules.matchAll(/([^{}]+)\{[^{}]*font-family:([^;}]+)/g)].map((m) => [m[1]!.trim().split("\n").pop(), m[2]]);
    for (const [selector, family] of families) {
      if (selector === "@font-face") {
        expect(['"IBM Plex Sans"', '"Source Serif 4"', '"Caveat"', '"IBM Plex Sans Fallback"', '"Source Serif 4 Fallback"', '"Source Serif 4 Fallback Times"']).toContain(family);
      }
      else if (family === "var(--mono)") expect([".doc code", ".doc pre", ".cite .addr", ".asked code", ".feed-addr"], selector).toContain(selector);
      else if (family === "var(--hand)") expect(selector).toBe(".brand span");
      else expect(["var(--font)", "var(--serif)"], selector).toContain(family);
    }
    expect(rules).not.toMatch(/[{;]font:(?!inherit[;}])/);
  });

  it("declares the five font files, all subsets with font-display optional, and loads nothing else", () => {
    const all = [...rules.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]);
    const faces = all.slice(0, 5);
    expect(all).toHaveLength(11);
    expect(faces[0]).toContain('src:url("/fonts/ibm-plex-sans-var.woff2")');
    expect(faces[0]).toContain("font-weight:400 600");
    expect(faces[1]).toContain('src:url("/fonts/ibm-plex-sans-italic.woff2")');
    expect(faces[2]).toContain('src:url("/fonts/source-serif-4-var.woff2")');
    expect(faces[2]).toContain("font-weight:400 600");
    expect(faces[3]).toContain('src:url("/fonts/source-serif-4-italic.woff2")');
    expect(faces[3]).toContain("font-style:italic");
    expect(faces[4]).toContain('src:url("/fonts/caveat-wordmark.woff2")');
    expect(faces[4]).toContain("font-weight:700");
    for (const face of faces) expect(face).toContain("font-display:optional");
    expect(rules.match(/url\((?!"data:)/g)).toHaveLength(8);
    expect(rules.match(/url\("\/chevron(?:-dark)?\.svg"\)/g)).toHaveLength(3);
  });

  it("backs each web family with a local font adjusted to its metrics, so the swap moves nothing", () => {
    const fallbacks = [...rules.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]).slice(5);
    expect(fallbacks).toHaveLength(6);
    const sources = fallbacks.map((face) => /src:local\("([^"]+)"\)/.exec(face)?.[1]);
    expect(sources).toEqual(["Georgia", "Georgia Bold", "Times New Roman", "Times New Roman Bold", "Arial", "Arial Bold"]);
    for (const face of fallbacks) {
      expect(face).toMatch(/size-adjust:\d+(\.\d+)?%;ascent-override:\d+(\.\d+)?%;descent-override:\d+(\.\d+)?%;line-gap-override:0%/);
      expect(face).not.toContain("url(");
    }
    expect(fallbacks.slice(0, 2).join()).toContain('"Source Serif 4 Fallback"');
    expect(fallbacks.slice(4).join()).toContain('"IBM Plex Sans Fallback"');
  });

  it("uses only the weights the font files cover", () => {
    const weights = [...rules.matchAll(/font-weight:(\d+)/g)].map((m) => m[1]);
    expect(new Set(weights)).toEqual(new Set(["400", "500", "600", "700"]));
    expect(rules.match(/font-weight:700/g)).toHaveLength(2);
  });

  it("never sets text below 14 px except the small-capital labels at 12 px, and only the superscripts, markers and code are relative", () => {
    const scaled = base(rules);
    const tokens = [...scaled.matchAll(/--(?:xl|l|m|s|xs|law-size):([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(tokens.length).toBeGreaterThan(10);
    for (const size of tokens) expect(size).toBeGreaterThanOrEqual(14);
    const declared = [...scaled.matchAll(/([^{}]+)\{[^{}]*font-size:([\d.]+)px/g)].map((m) => [m[1]!.trim().split("\n").pop()!, Number(m[2])] as const);
    expect(declared.length).toBeGreaterThan(20);
    const labels = [".display-panel legend", ".footer-col h2", ".data th", ".pagination-title", ".head .options.inline legend", ".toc-head .ttl", ".panel h2", ".data.stack td::before"];
    for (const [selector, size] of declared) {
      if (size < 14) {
        expect(size, selector).toBe(12);
        expect(labels, selector).toContain(selector);
      }
    }
    const relative = [...rules.matchAll(/([^{}]+)\{[^{}]*font-size:[\d.]+r?em/g)].map((m) => m[1]!.trim().split("\n").pop());
    expect(relative).toEqual([".asked code", ".doc code"]);
    expect(block("sup")).toBe("sup{font-size:max(12px,.75em);line-height:0");
    expect(block(".p .n")).toContain("font-size:max(14px,.72em)");
    for (const selector of [".p .who", ".src", ".cite .addr", ".lbl,.now,.act", ".toc-note", ".p .chg", ".gap", ".legend", ".pair.head", ".art .prov", ".home-strip div"]) {
      expect(block(selector), selector).toMatch(/font-size:14px;line-height:20px/);
    }
  });

  it("scales the whole interface with the text size, never below the 12 px label floor", () => {
    expect(block(":root")).toContain("--k:1;");
    for (const [size, k] of [["15", ".9"], ["16", ".94"], ["17", ".97"], ["21", "1.1"]]) {
      expect(block("html.text-" + size), size).toContain("--k:" + k);
    }
    expect(css).toContain("--xl:calc(44px*var(--k));--xl-lh:calc(50px*var(--k));--l:calc(28px*var(--k))");
    expect(css).toContain("--s:calc(16px*var(--k));--s-lh:calc(24px*var(--k));--xs:calc(14px*var(--k));--xs-lh:calc(20px*var(--k))");
    const sizes = [...rules.matchAll(/font-size:([^;}]+)/g)].map((m) => m[1]!);
    expect(sizes.length).toBeGreaterThan(50);
    for (const size of sizes) {
      if (/^(var\(--|max\(1[24]px,\.|[\d.]+r?em|inherit)/.test(size)) continue;
      expect(size).toMatch(/^(calc\([\d.]+px\*var\(--k\)\)|max\(12px,calc\(12px\*var\(--k\)\)\))$/);
    }
    expect(rules).not.toMatch(/font-size:max\((?!12px,calc\(12px\*var\(--k\)\))[\d.]+px,calc/);
  });

  it("follows the type scale on large screens and on phones", () => {
    expect(light).toContain("--xl:44px;--xl-lh:50px;--l:28px;--l-lh:36px;--m:22px;--m-lh:30px;--s:16px;--s-lh:24px;--xs:14px;--xs-lh:20px;");
    expect(light).toContain("--law-size:19px;--law-lh:32px;--bar:64px;");
    expect(css).not.toContain("--measure");
    expect(block(".plain.columns")).toBe(".plain.columns{display:grid;grid-template-columns:repeat(auto-fill,minmax(14em,1fr));gap:0 24px");
    expect(css).toContain(".shell>main:not(:has(~.rail)){grid-column:1/-1}");
    expect(css).not.toContain(".doc :is(p,ul,ol,dl,pre,.summary)");
    expect(media("(min-width:1360px)")).toContain(".with-contents .warning.fresh-note{display:none}");
    expect(block(".time .date-row")).toBe(".time .date-row{flex-wrap:nowrap;min-width:0;align-items:center");
    expect(block(".time .date-row .btn")).toBe(".time .date-row .btn{flex:none");
    expect(block(".time .date-row select.field")).toBe(".time .date-row select.field{flex:0 1 auto;min-width:0");
    expect(css).not.toContain(":not(:has(~.rail)) :is(p,ul,ol,dl,pre,.summary)");
    expect(block(".law")).toContain("max-width:calc(64ch + var(--mk))");
    expect(block(".src")).toContain("overflow:clip;overflow-clip-margin:4px;margin:24px 0 32px;padding-top:16px;border-top:1px solid var(--border)");
    expect(block(".src p")).toBe(".src p{display:flex;flex-wrap:wrap;row-gap:4px;margin:0 0 0 -14px");
    expect(block(".src p>span")).toBe(".src p>span{margin:0 14px 0 -1px;padding-left:14px;border-left:1px solid var(--border)");
    expect(block(".src p>span:last-child")).toBe(".src p>span:last-child{margin-right:0");
    expect(css).not.toContain(".src>span+span");
    expect(css).not.toMatch(/(^|[\n}])\.report\{/);
    expect(phone).toContain(".plain.columns{grid-template-columns:minmax(0,1fr)}");
    expect(phone).toContain(":root{--xl:32px;--xl-lh:38px;--l:24px;--l-lh:32px;--m:20px;--m-lh:28px;--law-size:17px;--law-lh:28px;");
    expect(block("h1")).toContain("font-size:var(--xl);line-height:var(--xl-lh)");
    expect(block("h2")).toContain("font-size:var(--l);line-height:var(--l-lh)");
    expect(block("h3")).toContain("font-size:var(--m);line-height:var(--m-lh)");
    expect(block("h1,h2,h3")).toContain("font-weight:600");
    expect(block("h1 .ttl")).toContain("font-style:italic;font-weight:400");
    expect(block(".caption")).toContain("font-size:var(--s);line-height:var(--s-lh);color:var(--secondary)");
    expect(block(".crumbs")).toContain("font-size:var(--xs);line-height:var(--xs-lh);color:var(--secondary)");
    expect(block(".crumbs")).not.toContain("uppercase");
    expect(block("html")).toContain("scrollbar-gutter:stable");
    expect(block("html::-webkit-scrollbar")).toBe("html::-webkit-scrollbar{width:12px");
    expect(block("html::-webkit-scrollbar-thumb")).toContain("border:3px solid var(--page);border-radius:6px;background:var(--border-strong);background-clip:padding-box");
    expect(block("html::-webkit-scrollbar-button")).toContain("display:none");
    expect(css).toContain("@supports not selector(::-webkit-scrollbar){html{scrollbar-color:var(--border-strong) var(--page)}}");
    expect(block(".law")).toContain("font-size:var(--law-size);line-height:var(--law-lh)");
    expect(block("body")).toContain("font-size:var(--s);line-height:var(--s-lh)");
    expect(block("article h2,.solo h2")).toContain("font-size:24px;line-height:32px");
    expect(block(".home h2,.doc h2")).toContain("font-size:var(--l);line-height:var(--l-lh)");
    expect(css).not.toMatch(/(\.art|\.toc) h[23]\{[^}]*font-size/);
  });

  it("underlines links in running text, thickens the line on hover and keeps visited links the same", () => {
    expect(block("a")).toContain("color:var(--brand);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.15em");
    expect(block("a:hover")).toContain("color:var(--brand-hover);text-decoration-thickness:2px");
    expect(css).not.toContain(":visited");
    expect(css).toMatch(/:is\(\.plain,\.nav,\.crumbs,\.toc,[^)]*\) a\{text-decoration:none\}/);
    expect(css).toMatch(/:is\(\.plain,\.nav,\.crumbs,\.toc,[^)]*\) a:hover\{text-decoration:none\}/);
    expect(block(".toc-list>a.more")).not.toContain("underline");
  });

  it("shows a yellow ring inside a text-coloured ring on focusable elements, a brand ring on fields, and never a yellow fill", () => {
    expect(block(":focus-visible")).toBe(":focus-visible{outline:2px solid var(--text);outline-offset:2px;box-shadow:0 0 0 2px var(--accent)");
    expect(block(".checkbox input:focus-visible+label::before")).toContain("outline:2px solid var(--text);outline-offset:2px;box-shadow:0 0 0 2px var(--accent)");
    expect(block(".field:focus-visible")).toBe(".field:focus-visible{outline:2px solid var(--brand);outline-offset:0;border-color:var(--brand);box-shadow:none");
    expect(rules).not.toMatch(/focus[^{]*\{[^}]*background/);
  });

  it("draws buttons flat in the brand colour, outlined when secondary, smaller in the rail", () => {
    const button = block(".btn");
    for (const part of ["min-height:40px", "padding:0 16px", "border-radius:4px", "background:var(--brand)", "color:var(--on-brand)", "font-size:15px", "font-weight:500"]) {
      expect(button, part).toContain(part);
    }
    expect(css).toContain("@media (hover:hover){.btn:hover{background:var(--brand-hover);border-color:var(--brand-hover)}}");
    expect(block(".btn.secondary")).toContain("background:transparent;color:var(--brand)");
    expect(css).toContain("@media (hover:hover){.btn.secondary:hover{background:var(--brand-tint);border-color:var(--brand)}}");
    expect(block(".rail .btn")).toBe(".rail .btn{min-height:36px;padding:0 10px;font-size:14px");
    expect(block(".cite-links")).toContain("display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px");
    expect(block(".p>.copy")).toContain("border:0;border-radius:4px;background:none");
    const shadows = [...rules.matchAll(/([^{}]+)\{[^{}]*box-shadow:([^;}]+)/g)].map((m) => m[1]!.trim().split("\n").pop()!);
    expect(shadows).toEqual([":focus-visible", "main:focus-visible", ".display-panel", ".sizes label:has(:focus-visible)", ".menu-panel .display-panel", ".search-hint", ":is(.header-bar,.page-search) .search-results", ".search-overlay .sheet", ".field:focus-visible", ".checkbox input:focus-visible+label::before", ".copied", ".pt.cur,.pt.rng", ".toc-bar", ".pt,.pt.cur,.pt.rng"]);
    expect(css).not.toContain(".home .site-header{position:static}");
  });

  it("draws fields on the paper with a 1 px strong border and a select with the chevron of the theme, served from the site", () => {
    const field = block(".field");
    expect(field).toContain("height:40px");
    expect(field).toContain("padding:0 12px");
    expect(field).toContain("border:1px solid var(--border-strong)");
    expect(field).toContain("background:var(--paper)");
    expect(field).toContain("font-size:var(--s)");
    const select = block("select.field");
    expect(select).toBe(
      "select.field{appearance:none;width:auto;max-width:100%;min-width:11.5em;padding-right:40px;background-image:var(--chevron);background-repeat:no-repeat;background-position:right 12px center;background-size:16px 16px",
    );
    expect(css).not.toContain("data:image");
    expect(block(".date-input")).toContain("position:relative;display:inline-block");
    expect(block(".field.date")).toContain("width:11em;padding-right:40px");
    const open = block(".date-open");
    expect(open).toContain("position:absolute;top:1px;right:1px;bottom:1px");
    expect(open).toContain("width:38px");
    expect(open).toContain("border:0;border-radius:0 3px 3px 0;background:none;color:var(--secondary)");
    expect(css).toContain(".date-open:focus-visible{color:var(--brand)}");
    expect(block(".time")).toContain("border-top:1px solid var(--border)");
    expect(block(".time .label")).toContain("display:inline");
    expect(block(".label")).toContain("font-weight:500");
    expect(block(".date-picker")).toContain("opacity:0");
  });

  it("draws badges as coloured words, without a box or a mark, in four variants", () => {
    const badge = block(".badge");
    for (const part of ["display:inline", "font-weight:600", "font-size:var(--xs)", "line-height:20px"]) {
      expect(badge, part).toContain(part);
    }
    expect(badge).not.toContain("background");
    expect(badge).not.toContain("padding");
    expect(css).not.toContain(".badge::before");
    expect(block(".badge-green")).toBe(".badge-green{color:var(--success)");
    expect(block(".badge-grey")).toBe(".badge-grey{color:var(--secondary)");
    expect(block(".badge-yellow")).toBe(".badge-yellow{color:var(--accent-text)");
    expect(block(".badge-red")).toBe(".badge-red{color:var(--danger)");
    expect(rules).not.toMatch(/\.tag\b|\.chip|\.sw\b|\.card\b/);
  });

  it("draws checkboxes as 20 px boxes that fill with the brand colour and a white tick", () => {
    expect(block(".checkbox label::before")).toContain("width:20px;height:20px;border:1px solid var(--border-strong);border-radius:4px");
    expect(block(".checkbox input:checked+label::before")).toContain("background:var(--brand)");
    expect(block(".checkbox label::after")).toContain("border:solid var(--on-brand)");
    expect(block(".checkbox input")).toContain("width:44px;height:44px");
    expect(css).toContain(".js .options .apply{display:none}");
    expect(block(".options.inline fieldset")).toContain("display:flex;flex-wrap:wrap;align-items:center");
    expect(block(".options.inline legend")).toContain("float:left");
    expect(coarse).toContain(".options.inline .checkbox{min-height:44px}");
  });

  it("draws the masthead navy under a gold rule, with a white wordmark, a white search field and white links", () => {
    const header = block(".site-header");
    expect(header).toContain("background:var(--mast)");
    expect(header).toContain("border-bottom:3px solid var(--accent)");
    expect(block(".header-bar")).toContain("display:grid;grid-template-columns:minmax(max-content,1fr) minmax(0,560px) minmax(max-content,1fr)");
    expect(block(".header-bar>.omni .field")).toContain("min-width:0");
    expect(block(".nav")).toContain("white-space:nowrap");
    expect(block(".header-bar")).toContain("height:calc(var(--head) - 3px)");
    expect(phone).toContain(".header-bar{display:flex;gap:8px}");
    expect(css).not.toContain(".home .nav{margin-left:auto}");
    expect(light).toContain("--head:68px");
    expect(phone).toContain("--head:60px");
    expect(block(".brand,.brand:hover")).toContain("color:var(--on-mast)");
    expect(block(".brand span")).toContain("font-weight:700;font-size:32px;line-height:1;letter-spacing:.01em;text-transform:lowercase");
    expect(css).not.toContain(".brand::before");
    expect(block(".nav a")).toContain("color:var(--on-mast)");
    expect(block(".nav a::after,.tabs-item a::after")).toContain("content:attr(data-text);display:block;height:0;overflow:hidden;visibility:hidden;font-weight:600");
    const current = block(":is(.nav,.menu-panel nav) a[aria-current]");
    expect(current).toContain("font-weight:600");
    expect(current).toContain("text-decoration-color:var(--accent)");
    expect(block(".menu-panel nav a::after")).toBe(".menu-panel nav a::after{content:none");
    expect(block(".header-bar>.omni")).toContain("background:#ffffff");
    expect(block(".header-bar>.omni .field")).toContain("border:0;background:none;color:#1a1a1a");
    expect(block(".find,.menu>summary")).toContain("border:1px solid var(--on-mast)");
    expect(block(".find,.menu>summary")).toContain("color:var(--on-mast)");
    expect(block(".site-footer .brand,.site-footer .brand:hover")).toContain("color:var(--brand)");
  });

  it("draws the footer on the canvas under a gold rule: the wordmark and licence beside three columns, then one meta line", () => {
    const footer = block(".site-footer");
    expect(footer).toContain("border-top:3px solid var(--accent)");
    expect(footer).toContain("background:var(--page)");
    expect(block(".footer-head")).toContain("grid-template-columns:minmax(0,2fr) minmax(0,3fr)");
    expect(css).toContain("@media (min-width:641px){.footer-nav{grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 40px}}");
    expect(block(".footer-col h2")).toContain("text-transform:uppercase");
    expect(block(".footer-meta")).toContain("justify-content:space-between");
    expect(block(".footer-meta")).toContain("border-top:1px solid var(--border)");
    expect(block(".js :is(.to-top,.to-bottom)")).toContain("position:fixed;right:24px;");
    expect(block(".js :is(.to-top,.to-bottom)")).toContain("opacity:0;pointer-events:none;visibility:hidden");
    expect(block(".js :is(.to-top,.to-bottom)")).not.toContain("transition");
    expect(css).not.toContain(".t.lead");
    expect(block(".display")).toBe(".display{display:none;position:relative");
    expect(block(".js .display")).toBe(".js .display{display:block");
    expect(block(".display-panel")).toContain("position:absolute;top:calc(100% + 14px);right:0");
    expect(block(".menu-panel .display-panel")).toContain("position:static");
    expect(block(".nav .display")).toBe(".nav .display{padding-left:28px;border-left:1px solid rgb(255 255 255/.35)");
    expect(block(".menu-panel .display")).toBe(".menu-panel .display{margin-top:8px;padding-top:8px;border-top:1px solid var(--border)");
    expect(block(".sizes label:has(:checked)")).toContain("background:var(--brand);color:var(--on-brand)");
    expect(block(".js :is(.to-top,.to-bottom)")).toContain("bottom:24px;opacity:0");
    expect(css).not.toMatch(/\.js \.to-(top|bottom)\{/);
    expect(block(".js :is(.to-top,.to-bottom).show")).toBe(".js :is(.to-top,.to-bottom).show{opacity:1;pointer-events:auto;visibility:visible");
    expect(css).toContain(".doc li:not(.crumbs *)");
    expect(css).not.toContain(".lang");
    expect(css).not.toContain("width-wide");
    expect(block(".track li.start .now,.track li.start .lbl,.track li.start .act")).toContain("transform:none;text-align:left");
    expect(phone).toContain(".footer-head{grid-template-columns:minmax(0,1fr);gap:24px}");
    expect(css).not.toContain(".footer-status");
  });

  it("lays the text of a page on a white sheet over the canvas, edge to edge on phones, and not on the home page", () => {
    expect(block("body")).toContain("overflow-x:clip;background:var(--page)");
    expect(css).toContain("\nmain>article,main>.solo{background:var(--paper);border:1px solid var(--border);padding:40px 56px 48px}");
    expect(block(".home main>.solo")).toContain("background:none;border:0;padding:0");
    expect(phone).toContain("main>article,main>.solo{margin:0 -16px;padding:24px 16px 32px;border-left:0;border-right:0}");
    expect(media("(max-width:1359px)")).toContain("main>article,main>.solo{padding-right:32px;padding-left:32px}");
    expect(media("(min-width:1360px)")).toContain("padding-right:clamp(24px,calc(24px + (100vw - 1360px)*.4),56px)");
    expect(block(".home")).toContain("background:var(--paper)");
  });

  it("styles the filter panel on the surface, the results bar and the search filters", () => {
    const filters = block(".filters");
    expect(filters).toContain("padding:16px 24px 8px");
    expect(filters).toContain("background:var(--surface)");
    expect(phone).toContain(".filters{display:block;padding:16px}");
    expect(block(".results-bar")).toContain("justify-content:space-between");
    expect(block(".results-bar .count")).toContain("font-weight:600");
    expect(block(".search-filters")).toContain("margin:0 0 24px");
    expect(block(".search-row")).toContain("display:flex");
    expect(css).not.toContain(".search-filters .apply");
  });

  it("labels rail sections in capitals without boxes and sets the citation in the serif with a monospace address", () => {
    expect(block(".panel")).toBe(".panel{margin:0 0 32px");
    expect(block(".panel h2")).toContain("font-size:12px;line-height:20px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)");
    expect(block(".cite")).toContain("font-family:var(--serif)");
    expect(block(".cite")).not.toContain("background");
    expect(block(".cite .addr")).toContain("font-family:var(--mono)");
    expect(block(".rail .plain li")).toContain("border-bottom:1px solid var(--border)");
    expect(block(".rail .warning")).toContain("border-left:3px solid var(--danger);background:none");
  });

  it("keeps the warning text bold in the rail, shows the strike-through and underline in the legend, and keeps hidden diff words out of a copy", () => {
    expect(css).not.toContain(".rail .warning-text");
    expect(css).not.toContain(".legend ins");
    expect(block("del .vh,ins .vh")).toContain("user-select:none");
  });

  it("reveals the copy button of a paragraph on hover and focus without taking space", () => {
    expect(block(".p>.copy")).toContain("position:absolute");
    expect(block(".p>.copy")).toContain("opacity:0");
    expect(css).toContain(".p:hover>.copy,.p:focus-within>.copy,.p>.copy:focus-visible{opacity:1}");
    expect(css).toContain("@media (hover:none){.p>.copy{opacity:1}}");
    expect(block(".p>.copied")).toContain("top:52px");
  });

  it("sets an article that is not in force yet apart from a repealed one", () => {
    expect(block(".toc-list>a.rep .n")).toContain("text-decoration:line-through");
    expect(block(".toc-list>a.fut")).toContain("font-style:italic");
    expect(block(".toc-list>a.fut")).not.toContain("line-through");
  });

  it("draws inset, warning and banner as ruled boxes with square corners", () => {
    expect(block(".inset,.warning")).toContain("padding:16px 20px;border-left:4px solid var(--brand);background:var(--surface)");
    expect(block(".warning")).toContain("border-left-color:var(--danger)");
    expect(block(".dated")).toBe(
      ".dated{margin:-6px 0;padding:6px 12px;border-left:3px solid var(--brand);background:var(--brand-tint);font-size:var(--xs);line-height:var(--xs-lh)",
    );
    expect(block(".dated p")).toContain("margin:0");
    expect(block(".crumb-row")).toContain("justify-content:space-between;align-items:center");
    expect(css).not.toContain(".head-side");
    expect(css).not.toContain(".banner");
    expect(css).not.toContain(".notification");
  });

  it("draws tabs on a hairline with the selected tab underlined in gold, scrolling sideways on phones", () => {
    expect(block(".tabs")).toContain("border-bottom:1px solid var(--border)");
    expect(block(".tabs-list")).toContain("margin:0 0 -1px");
    expect(block(".tabs-list")).toContain("overflow-x:auto;scrollbar-width:none");
    const tab = block(".tabs-item a");
    expect(tab).toContain("border-bottom:3px solid transparent");
    expect(tab).toContain("font-weight:500");
    expect(tab).toContain("color:var(--secondary)");
    expect(block(".tabs-item.selected a")).toBe(".tabs-item.selected a{border-bottom-color:var(--accent);color:var(--text);font-weight:600");
    expect(coarse).toContain(".tabs-item a{display:grid;align-content:center}");
    expect(block(".tabs-panel")).toContain("padding:24px 0 0");
    expect(block(".tabs-panel")).not.toContain("border");
  });

  it("draws tables with capitals over a strong rule in the header and rows divided by hairlines", () => {
    expect(block(".data th")).toContain("border-bottom:1px solid var(--border-strong)");
    expect(block(".data th")).toContain("text-transform:uppercase");
    expect(block(".data th,.data td")).toContain("border-bottom:1px solid var(--border)");
    expect(block("table.data")).toContain("font-variant-numeric:tabular-nums");
    expect(rules).not.toContain("nth-child(even)");
    expect(rules).not.toContain("nth-child(odd)");
  });

  it("lays the lists of acts in rows of three columns, the name in the serif, the whole row one target", () => {
    expect(block(".doc-list li")).toContain("grid-template-columns:minmax(0,5fr) 13em minmax(0,5fr) minmax(0,3fr)");
    expect(block(".doc-meta")).toBe(".doc-meta{display:contents");
    expect(block(".doc-main")).toBe(".doc-main{display:grid;grid-column:1/4;grid-template-columns:subgrid;align-items:baseline");
    expect(phone).toContain(".doc-main{grid-column:1}");
    expect(block(".doc-link")).toContain("font-family:var(--serif);font-size:21px");
    expect(block(".doc-link::after")).toContain("inset:0");
    expect(css).toContain("@media (hover:hover){.doc-list li:hover{background:var(--surface)}}");
    expect(phone).toContain(".doc-list li{grid-template-columns:minmax(0,1fr);");
    expect(css).not.toContain(".doc-list.columns");
    expect(block(".doc-list.grid")).toContain("grid-template-columns:repeat(auto-fill,minmax(16em,1fr))");
    expect(block(".rail")).toContain("padding-left:24px");
  });

  it("builds the home page from the hero on the canvas with the numbers beside the title, the codes, the date row and the changes", () => {
    expect(block(".home-hero")).toContain("margin:0 calc(50% - 50vw)");
    expect(block(".home-hero")).toContain("background:var(--page)");
    expect(block(".home-hero>div")).toContain("grid-template-columns:minmax(0,7fr) minmax(0,5fr)");
    expect(block(".home-hero h1 em")).toBe(".home-hero h1 em{font-style:normal;color:var(--brand)");
    expect(css).not.toContain(".home-search");
    expect(block(".home-strip")).toContain("grid-template-columns:repeat(auto-fit,minmax(150px,1fr))");
    expect(block(".home .solo>.home-hero")).toBe(".home .solo>.home-hero{margin-top:0");
    expect(block(".home-strip div")).toContain("border-top:1px solid var(--border-strong)");
    expect(block(".home-strip dd")).toContain("font-family:var(--serif);font-size:30px");
    expect(phone).toContain(".home-strip{gap:0 16px}");
    expect(block(".home-row")).toContain("grid-template-columns:minmax(0,1fr) minmax(0,1fr)");
    expect(css).toContain("@media (min-width:1101px){.home-changes.split{grid-template-columns:minmax(0,2fr) minmax(0,1fr);column-gap:64px}}");
    expect(css).not.toContain(".stats");
  });

  it("separates the two pagination cells with a hairline and keeps them side by side on phones", () => {
    expect(block(".pagination-prev+.pagination-next")).toContain("border-left:1px solid var(--border)");
    expect(block(".pagination-label")).toContain("color:var(--brand);font-family:var(--serif)");
    expect(block(".pagination-prev:has(+.pagination-next)")).toBe(".pagination-prev:has(+.pagination-next){padding-right:24px");
    expect(block(".pagination-title")).toContain("text-transform:uppercase");
    expect(phone).not.toContain(".pagination{flex-direction:column}");
    expect(phone).toContain(".pagination-prev+.pagination-next{padding-left:12px}");
  });

  it("sets the law text in the serif with the marker in the margin, bars only for the attribution and the gold mark", () => {
    expect(block(".p")).toContain("padding:0 0 0 var(--mk);border-left:3px solid transparent");
    expect(block(".p .n")).toContain("position:absolute;top:.35em;left:8px;width:calc(var(--mk) - 8px);white-space:nowrap");
    expect(block(".law")).toContain("--mk:max(44px,calc(var(--law-size)*2.4))");
    expect(block(".p .n")).toContain("font-family:var(--font)");
    for (let n = 1; n <= 8; n++) expect(css).toContain(`.attr .p.b${n}{border-left-color:var(--b${n})}`);
    expect(css).not.toMatch(/\n\.p\.b\d\{/);
    expect(block(".hl .p.last")).toBe(".hl .p.last{border-left-color:var(--accent);background:var(--accent-tint);padding-top:8px;padding-bottom:8px;padding-right:12px");
    expect(block(".p .who")).toContain("font-family:var(--font);font-size:14px");
    expect(css).toContain(".attr .p .who,.hl .p.last .who{display:flex}");
    expect(css).toContain(".attr .p .who .by{display:flex}");
    expect(css).toContain(":is([id],a,button,input,select,textarea,summary){scroll-margin-top:calc(var(--head) + 16px)}");
    expect(block(".law.flow .p")).toContain("border-left:0");
    expect(css).toContain(".cmp .p.changed,.cmp .p.added,.cmp .p.removed,.pair .cell.changed .p,.pair .cell.added .p,.pair .cell.removed .p{border-left-color:var(--accent)}");
  });

  it("draws timeline markers as rings, the shown version filled with a halo, the act under the dates that matter", () => {
    expect(block(".pt")).toContain("width:14px;height:14px;border:2px solid var(--brand);border-radius:50%;background:var(--paper)");
    expect(block(".pt.cur,.pt.rng")).toContain("background:var(--brand);box-shadow:0 0 0 3px var(--paper),0 0 0 5px var(--brand)");
    expect(block(".track .ln")).toContain("height:2px");
    expect(block(".act")).toContain("display:none");
    expect(css).toContain(".track li:first-child .act,.track li.cur .act{display:block}");
    expect(block(".track.even")).toContain("overflow-x:auto");
    expect(block(".track-in")).toContain("position:relative");
    expect(phone).toContain(".track-in{height:auto;margin-top:0;min-width:0!important}");
    expect(phone).toContain(".track ol::before{content:\"\";position:absolute;top:0;bottom:0;left:5px;width:2px;background:var(--border)}");
    expect(phone).toContain(".pt::before{content:\"\";position:absolute;top:16px;left:0;width:12px;height:12px;border-radius:50%;background:var(--border-strong)}");
    expect(phone).toContain(".pt.cur::before,.pt.rng::before{background:var(--brand)}");
    expect(phone).toContain(".track .ln,.track .span{display:none}");
  });

  it("leaves 2 px at the sides of the contents filter for its focus ring inside the scrolling column", () => {
    expect(block(".toc .flt")).toContain("margin:0 2px 12px");
  });

  it("draws the side columns' scrollbar thin and without buttons, keeping the WebKit styles alive in Chrome", () => {
    expect(block(".with-contents .shell>.toc-sheet .toc-list,.with-contents .shell>.rail,.rail .ruling-list")).toBe(".with-contents .shell>.toc-sheet .toc-list,.with-contents .shell>.rail,.rail .ruling-list{scrollbar-gutter:stable");
    expect(block(".with-contents .shell>.toc-sheet .toc-list")).toContain("flex:1 1 auto;min-height:0;padding:0 16px 8px 0;border-bottom:1px solid var(--border);overflow:auto");
    expect(css).toContain(".with-contents .shell>.toc-sheet{display:flex;position:sticky;top:calc(var(--head) + 32px);max-height:calc(100vh - var(--head) - 64px);padding:0;overflow:clip}");
    expect(css).toContain("::-webkit-scrollbar-button{display:none;width:0;height:0}");
    expect(css).toContain("@supports not selector(::-webkit-scrollbar){.with-contents .shell>.toc-sheet .toc-list,.with-contents .shell>.rail,.rail .ruling-list{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}}");
  });

  it("fills the open article of the contents with the brand colour and marks its number in gold", () => {
    expect(block(".toc-list>a.cur")).toContain("background:var(--mast);color:var(--on-mast);font-weight:600");
    expect(block(".toc-list>a.cur .n")).toBe(".toc-list>a.cur .n{color:var(--accent)");
    expect(block(".toc-list>a")).toContain("border-radius:4px");
    expect(block(".toc-list>a")).not.toContain("border-left");
    expect(block(".toc-head .ttl")).toContain("text-transform:uppercase");
  });

  it("turns the contents list into a sheet with a bottom bar below 1100 px and never hides it", () => {
    expect(narrow).not.toMatch(/\.(toc|rail)\{display:none/);
    expect(narrow).toContain(".with-contents .shell>.toc-sheet{display:none;position:fixed;inset:0");
    expect(narrow).toContain(".with-contents .shell>.toc-sheet:target,.with-contents .shell>.toc-sheet.open{display:block}");
    expect(narrow).toContain("env(safe-area-inset-bottom)");
    expect(narrow).toContain(".toc-bar{position:fixed");
    expect(css.replace(narrow, "")).toContain(".toc-bar{display:none}");
  });

  it("lays pages out in one 1440 px container, with a 260 px contents column and a 300 px rail on article pages", () => {
    expect(block(".wrap")).toContain("max-width:1440px;margin:0 auto;padding:0 32px");
    expect(css).not.toContain(".with-contents .wrap");
    expect(block(".shell")).toContain("grid-template-columns:minmax(0,1fr) 300px;grid-template-rows:minmax(0,1fr) auto;column-gap:40px");
    expect(block(".shell>.site-footer")).toContain("grid-column:1/-1;align-self:end");
    expect(block(".with-contents .shell>.site-footer")).toBe(".with-contents .shell>.site-footer{grid-column:2;grid-row:3;margin:72px 0 0;padding:28px 0 32px");
    expect(block(".head")).toContain("justify-content:space-between");
    expect(block(".with-contents .shell")).toContain("grid-template-columns:260px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto");
    expect(css).toContain(".with-contents .shell>.toc-sheet{display:flex;position:sticky;top:calc(var(--head) + 32px);max-height:calc(100vh - var(--head) - 64px)");
    expect(block(".shell")).toContain("padding-top:32px");
    expect(narrow).toContain(".with-contents .shell{grid-template-columns:minmax(0,1fr)}");
    expect(phone).toContain(".shell{grid-template-columns:minmax(0,1fr)");
    expect(phone).toContain(".wrap{padding:0 16px}");
  });

  it("opens the third column, the pinned rail and the contents beside the text only where the text keeps its measure", () => {
    const wide = media("(min-width:1360px)");
    expect(wide).toContain(".with-contents .shell{grid-template-columns:260px minmax(0,1fr) 300px;grid-template-rows:minmax(0,1fr) auto}");
    expect(wide).toContain(".with-contents .shell>.rail{grid-column:3;grid-row:1/3;position:sticky;top:calc(var(--head) + 32px);display:flex;flex-direction:column;max-height:calc(100vh - var(--head) - 64px);margin-top:0;overflow:auto");
    expect(wide).toContain(".with-contents .shell>.rail>.panel:has(.ruling-list){display:flex;flex:0 1 auto;flex-direction:column;min-height:calc(32px + 2 * (2 * var(--xs-lh) + 17px))}");
    expect(css).not.toContain("232px");
    const rail = block(".with-contents .shell>.rail");
    expect(rail).toContain("grid-column:2;grid-row:2;margin-top:32px");
    expect(rail).not.toContain("sticky");
    expect(media("(min-width:641px) and (max-width:1359px)")).toContain(".with-contents .rail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px;align-items:start}");
    expect(block(".with-contents .shell>.toc-sheet")).toBe(".with-contents .shell>.toc-sheet{grid-column:1;grid-row:1/4");
  });

  it("lets the facts under a title wrap, each on one line", () => {
    expect(block(".status")).toContain("display:flex;flex-wrap:wrap");
    expect(block(".status")).not.toContain("nowrap");
    expect(block(".status>*")).toBe(".status>*{white-space:nowrap");
  });

  it("shows notices that take no space and leaves the focus outline off the main landmark", () => {
    expect(block(".copied")).toContain("position:absolute");
    expect(block(".copied:empty")).toBe(".copied:empty{display:none");
    expect(block(".cite-links")).toContain("position:relative");
    expect(block(".cite-links .copied")).toContain("top:100%");
    expect(block(".p>.copied")).toContain("top:52px");
    expect(block("main:focus-visible")).toContain("outline:0");
  });

  it("gives the text-size buttons the same double ring as every other control", () => {
    expect(block(".sizes label:has(:focus-visible)")).toBe(".sizes label:has(:focus-visible){outline:2px solid var(--text);outline-offset:2px;box-shadow:0 0 0 2px var(--accent)");
  });

  it("labels the contents filter above its field", () => {
    expect(block(".toc .flt-label")).toContain("display:block");
  });

  it("opens the search overlay and the menu from text buttons on phones", () => {
    expect(phone).toContain(".find,.menu>summary{display:inline-flex}");
    expect(phone).toContain(".header-bar>.omni,.header-bar>.nav{display:none}");
    expect(phone).toContain(".search-overlay:target,.search-overlay.open{display:block}");
    expect(block(".find,.menu>summary")).toContain("min-height:40px");
    expect(block(".menu-panel nav a")).toContain("min-height:44px");
  });

  it("keeps every control at least 44 px tall on touch screens", () => {
    expect(coarse).toContain(".field,.search-button{height:44px}");
    expect(coarse).toContain(".btn{min-height:44px}");
    expect(coarse).toContain(".toc-list>a{align-content:center;min-height:44px}");
    expect(coarse).toContain(".pagination :is(a,.off){min-height:44px}");
  });

  it("highlights search matches on the accent tint in the text colour", () => {
    expect(block("mark")).toBe("mark{background:var(--accent-tint);color:var(--text);padding:0 1px");
  });

  it("prints the text alone, on white, without navigation or the sheet border", () => {
    const print = media("print");
    expect(print).toContain("--page:#ffffff;--paper:#ffffff;--text:#000000");
    expect(print).toContain(".p>.copy,.p>.copied{display:none}");
    expect(print).toContain(".skip,.site-header,.site-footer,.search-overlay,.menu,.display,.to-top,.to-bottom,.rail,.toc-sheet,.toc-bar,.tabs,.options,.time,.crumbs{display:none}");
    expect(print).toContain("main>article,main>.solo{border:0;padding:0}");
    expect(print).toContain(".shell{display:block}");
  });

  it("keeps fixed buttons and bars from covering what the reader reaches", () => {
    expect(block("html")).toContain("scrollbar-gutter:stable;scroll-padding-bottom:136px");
    expect(block("html")).not.toContain("scroll-padding-top");
    expect(block(".header-bar :is([id],a,button,input,select,textarea,summary)")).toContain("scroll-margin-top:0");
    expect(phone).toContain("html{scroll-padding-top:16px}");
    expect(narrow).toContain(".js .with-contents :is(.to-top,.to-bottom){bottom:calc(var(--bar) + env(safe-area-inset-bottom) + 24px)}");
    expect(phone).toContain(".js :is(.to-top,.to-bottom){right:16px;bottom:16px}");
    expect(phone).toContain(".js .with-contents :is(.to-top,.to-bottom){bottom:calc(var(--bar) + env(safe-area-inset-bottom) + 16px)}");
    expect(css).not.toMatch(/\+ 76px/);
    expect(narrow).toContain("html:has(.with-contents){scroll-padding-bottom:calc(var(--bar) + env(safe-area-inset-bottom) + 136px)}");
    expect(block(".js .site-footer")).toBe(".js .site-footer{padding-bottom:128px");
    expect(block("html:not(.clip) button[data-copy]")).toBe("html:not(.clip) button[data-copy]{display:none");
  });

  it("fades the edge of a tab strip that hides tabs, and sets the search sheet with the close link above the field", () => {
    expect(css).toContain(".tabs.fade-end .tabs-list{mask-image:linear-gradient(to right,#000 calc(100% - 40px),transparent)}");
    expect(css).toContain(".tabs.fade-start .tabs-list{mask-image:");
    expect(block(".search-overlay .close")).toContain("grid-row:1;justify-self:end");
    expect(block(".search-overlay .omni")).toContain("grid-template-columns:minmax(0,1fr) auto");
    expect(block(".search-overlay .omni .search-results")).toBe(".search-overlay .omni .search-results{grid-column:1/-1");
  });

  it("keeps the citation in print and nowhere else", () => {
    expect(block(".print-cite")).toBe(".print-cite{display:none");
    expect(media("print")).toContain(".print-cite{display:block;");
  });

  it("revalidates the stylesheet and the scripts on every load and caches the fonts for a year", async () => {
    for (const file of ["/styles.css", "/article.js", "/site.js"]) {
      expect(headers).toContain(file + "\n  Cache-Control: public, no-cache\n");
    }
    expect(headers).toContain("/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n");
    for (const file of ["ibm-plex-sans-var.woff2", "ibm-plex-sans-italic.woff2", "source-serif-4-var.woff2", "source-serif-4-italic.woff2", "caveat-wordmark.woff2"]) {
      const font = await env.ASSETS.fetch("https://assets.test/fonts/" + file);
      expect(font.status, file).toBe(200);
      await font.arrayBuffer();
    }
    const other = await env.ASSETS.fetch("https://assets.test/fonts/ibm-plex-mono-400.woff2");
    expect(other.status).toBe(404);
    await other.arrayBuffer();
  });

  it("sets indices small without pushing lines apart and keeps their caret for copying", () => {
    expect(block("sup")).toContain("line-height:0");
    expect(block(".vh")).toContain("clip-path");
    expect(block(".vh")).not.toContain("display:none");
  });
});

describe("case law in the rail", () => {
  it("scrolls inside its own list after about six decisions", () => {
    expect(block(".rail .ruling-list")).toContain(
      "max-height:calc(6.5 * (2 * var(--xs-lh) + 17px));overflow-y:auto;overscroll-behavior:contain",
    );
  });
});

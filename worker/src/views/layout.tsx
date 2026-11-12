import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { t } from "../text";
import { formatRo } from "../lib/dates";
import { builtDay } from "../lib/outages";
import { SITE_REPOSITORY, SOURCE_REPOSITORY, SUPPORT_URL } from "../lib/urls";
import { ArrowDownIcon, ArrowUpIcon, ExternalIcon, Logo, SearchIcon } from "./icons";

export type LayoutProps = {
  title: string;
  description?: string;
  canonical: string;
  noindex?: boolean;
  alternates?: { href: string; type: string; title: string }[];
  query?: string;
  script?: string;
  home?: boolean;
  toc?: Child;
  rail?: Child;
  cite?: { sentence: string; address: string };
  children?: Child;
};

export const PRE_PAINT = `document.documentElement.classList.add("js");try{var s=JSON.parse(localStorage.getItem("tdl.settings")||"{}"),r=document.documentElement;if(navigator.clipboard)r.classList.add("clip");if([15,16,17,19,21].indexOf(s.size)>-1)r.classList.add("text-"+s.size);if(s.theme==="light"||s.theme==="dark")r.setAttribute("data-theme",s.theme)}catch(e){}`;

const speculationRules = (skip: string) => {
  const where = {
    and: [
      { href_matches: "/*" },
      { not: { href_matches: ["/healthz", "/*.xml", "/*.atom"] } },
      { not: { selector_matches: skip } },
    ],
  };
  return JSON.stringify({
    prerender: [{ where, eagerness: "moderate" }],
    prefetch: [{ where, eagerness: "conservative" }],
  });
};

export const SPECULATION_RULES = speculationRules("[rel~=nofollow],[download]");

export const SCRIPTED_SPECULATION_RULES = speculationRules("[rel~=nofollow],[download],#page a");

export const ORIGIN = "https://textdelege.ro";

export function SearchForm(props: { query?: string; id: string; class: string }) {
  return (
    <form class={props.class} role="search" action="/cauta" method="get" data-all={t("searchAll")} data-empty={t("searchEmpty")}>
      <label class="vh" for={props.id}>
        {t("searchLabel")}
      </label>
      <input
        class="field"
        id={props.id}
        type="search"
        name="q"
        value={props.query}
        placeholder={t("searchPlaceholder")}
        autocomplete="off"
      />
      <button class="search-button" type="submit">
        <SearchIcon size={20} />
        <span class="vh">{t("searchButton")}</span>
      </button>
    </form>
  );
}

type Mark = "page" | "true" | undefined;

function sectionMarks(path: string, inCodes: boolean): { codes: Mark; acts: Mark; changes: Mark } {
  return {
    codes: path === "/" ? "page" : inCodes ? "true" : undefined,
    acts: path === "/acte" ? "page" : undefined,
    changes: path === "/modificari" ? "page" : path.startsWith("/modificari/") ? "true" : undefined,
  };
}

function NavLinks({ marks }: { marks: { codes: Mark; acts: Mark; changes: Mark } }) {
  return (
    <>
      <a href="/#coduri" aria-current={marks.codes} data-text={t("navCodes")}>
        {t("navCodes")}
      </a>
      <a href="/acte" aria-current={marks.acts} data-text={t("navActs")}>
        {t("navActs")}
      </a>
      <a href="/modificari" aria-current={marks.changes} data-text={t("navChanges")}>
        {t("navChanges")}
      </a>
    </>
  );
}

const TEXT_SIZES = [15, 16, 17, 19, 21];
const DEFAULT_TEXT_SIZE = 19;

function DisplayMenu({ id }: { id: string }) {
  const themes = [
    ["auto", "themeAuto"],
    ["light", "themeLight"],
    ["dark", "themeDark"],
  ] as const;
  return (
    <details class="display">
      <summary>{t("displayLabel")}</summary>
      <form class="display-panel">
        <fieldset>
          <legend>{t("displayTheme")}</legend>
          {themes.map(([value, label]) => (
            <label>
              <input type="radio" name={`${id}-theme`} value={value} checked={value === "auto"} />
              {t(label)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t("displayText")}</legend>
          <div class="sizes">
            {TEXT_SIZES.map((size) => (
              <label style={`font-size:${size}px`}>
                <input
                  type="radio"
                  name={`${id}-size`}
                  value={size}
                  checked={size === DEFAULT_TEXT_SIZE}
                  aria-label={t("displaySize", { n: size })}
                />
                A
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </details>
  );
}

function Brand({ onMast }: { onMast?: boolean }) {
  return (
    <a class="brand" href="/">
      <Logo size={onMast ? 36 : 30} onMast={onMast} />
      <span>{t("siteName")}</span>
    </a>
  );
}

type FooterLink = { label: string; href: string; external?: boolean };

function FooterColumn({ heading, links }: { heading: string; links: FooterLink[] }) {
  return (
    <div class="footer-col">
      <h2>{heading}</h2>
      <ul>
        {links.map((link) => (
          <li>
            <a href={link.href}>
              {link.label}
              {link.external && <ExternalIcon />}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer({ compact }: { compact?: boolean }) {
  const meta = (
    <div class="footer-meta">
      <p class="footer-text">{t("footerIndependent")}</p>
      <a class="to-top" href="#">
        <ArrowUpIcon size={20} />
        <span>{t("footerToTop")}</span>
      </a>
      <a class="to-bottom" href="#sfarsit">
        <ArrowDownIcon size={20} />
        <span>{t("footerToBottom")}</span>
      </a>
    </div>
  );
  if (compact) {
    const links: FooterLink[] = [
      { label: t("aboutTitle"), href: "/despre" },
      { label: t("footerLegend"), href: "/legenda" },
      { label: t("footerLicence"), href: "/despre#licenta" },
      { label: t("footerContact"), href: "/despre#contact" },
      { label: t("supportKofi"), href: SUPPORT_URL, external: true },
    ];
    return (
      <footer class="site-footer compact" id="sfarsit">
        <div class="wrap">
          <div class="footer-head">
            <Brand />
            <nav class="footer-line" aria-label={t("footerLinksLabel")}>
              {links.map((link) => (
                <a href={link.href}>
                  {link.label}
                  {link.external && <ExternalIcon />}
                </a>
              ))}
            </nav>
          </div>
          {meta}
        </div>
      </footer>
    );
  }
  return (
    <footer class="site-footer" id="sfarsit">
      <div class="wrap">
        <div class="footer-head">
          <div>
            <Brand />
            <p class="footer-licence">{t("footerLicenceLine")}</p>
          </div>
          <nav class="footer-nav" aria-label={t("footerLinksLabel")}>
          <FooterColumn
            heading={t("footerExplore")}
            links={[
              { label: t("navCodes"), href: "/#coduri" },
              { label: t("navActs"), href: "/acte" },
              { label: t("navChanges"), href: "/modificari" },
              { label: t("footerPointInTime"), href: "/legislatie" },
              { label: t("footerSearch"), href: "/cauta" },
            ]}
          />
          <FooterColumn
            heading={t("footerData")}
            links={[
              { label: t("footerFeed"), href: "/abonare" },
              { label: t("footerSourceData"), href: SOURCE_REPOSITORY, external: true },
              { label: t("supportCode"), href: SITE_REPOSITORY, external: true },
              { label: t("footerLicence"), href: "/despre#licenta" },
            ]}
          />
          <FooterColumn
            heading={t("footerAboutHeading")}
            links={[
              { label: t("aboutTitle"), href: "/despre" },
              { label: t("footerLegend"), href: "/legenda" },
              { label: t("footerFreshness"), href: "/despre#actualitate" },
              { label: t("footerContact"), href: "/despre#contact" },
              { label: t("supportKofi"), href: SUPPORT_URL, external: true },
            ]}
          />
          </nav>
        </div>
        {meta}
      </div>
    </footer>
  );
}

export function Layout(props: LayoutProps) {
  const { canonical } = props;
  const built = builtDay();
  const marks = sectionMarks(new URL(canonical, ORIGIN).pathname, props.toc !== undefined);
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="ro">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <title>{`${props.title} | ${t("siteName")}`}</title>
          {props.description && <meta name="description" content={props.description} />}
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="canonical" href={canonical} />
          {props.noindex && <meta name="robots" content="noindex" />}
          {props.alternates?.map((alternate) => (
            <link rel="alternate" type={alternate.type} href={alternate.href} title={alternate.title} />
          ))}
          <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
          <link rel="preload" href="/fonts/ibm-plex-sans-var.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="preload" href="/fonts/source-serif-4-var.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="preload" href="/fonts/source-serif-4-italic.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="preload" href="/fonts/caveat-wordmark.woff2" as="font" type="font/woff2" crossorigin="" />
          <link rel="stylesheet" href="/styles.css" />
          <script type="speculationrules" dangerouslySetInnerHTML={{ __html: props.script ? SCRIPTED_SPECULATION_RULES : SPECULATION_RULES }} />
          <script type="module" src="/site.js" />
          {props.script && <script type="module" src={props.script} />}
        </head>
        <body class={props.toc !== undefined ? "with-contents" : props.home ? "home" : undefined}>
          <a class="skip" href="#main">
            {t("skipToContent")}
          </a>
          <header class="site-header">
            <div class="wrap">
              <div class="header-bar">
                <Brand onMast />
                <SearchForm query={props.query} id="q" class="omni" />
                <nav class="nav" aria-label={t("mainNavLabel")}>
                  <NavLinks marks={marks} />
                  <DisplayMenu id="bar" />
                </nav>
                <a class="find" href="#cauta">
                  {t("searchButton")}
                </a>
                <details class="menu">
                  <summary>{t("menuLabel")}</summary>
                  <div class="menu-panel">
                    <nav aria-label={t("mainNavLabel")}>
                      <NavLinks marks={marks} />
                    </nav>
                    <DisplayMenu id="menu" />
                  </div>
                </details>
              </div>
            </div>
          </header>
          <div class="search-overlay" id="cauta">
            <a class="scrim" href="#" tabindex={-1} aria-hidden="true" />
            <div class="sheet">
              <SearchForm query={props.query} id="q-overlay" class="omni" />
              <a class="close" href="#">
                {t("searchClose")}
              </a>
            </div>
          </div>
          <div class="wrap shell" id="page">
            <main id="main" tabindex={-1}>
              {props.children}
              {props.cite && (
                <div class="print-cite">
                  <p>{props.cite.sentence}</p>
                  <p>{props.cite.address}</p>
                  {built !== null && <p>{t("printGenerated", { date: formatRo(built) })}</p>}
                </div>
              )}
            </main>
            {props.toc}
            {props.rail}
            <Footer compact={props.toc !== undefined} />
          </div>
        </body>
      </html>
    </>
  );
}

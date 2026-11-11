import { describe, expect, it } from "vitest";
import { formatRo } from "../src/lib/dates";
import { LawLink, lawLabelText } from "../src/views/shared";
import {
  Breadcrumbs,
  DataTable,
  DatedNote,
  DateField,
  DateHint,
  ErrorSummary,
  FieldError,
  Inset,
  Options,
  PageNumbers,
  Pagination,
  Panel,
  SummaryList,
  Tabs,
  Badge,
  Timeline,
  WarningText,
} from "../src/views/components";

const render = (node: unknown) => String(node);

describe("Badge", () => {
  it.each([
    ["green", "În vigoare"],
    ["grey", "Abrogat la 01.01.2024"],
    ["grey", "Text încheiat"],
    ["grey", "Formă anterioară"],
    ["yellow", "Text neconsolidat"],
    ["yellow", "Viitor"],
    ["red", "Eroare"],
  ] as const)("is a %s rectangle with its text and no mark", (colour, label) => {
    const html = render(<Badge colour={colour}>{label}</Badge>);
    expect(html).toBe(`<strong class="badge badge-${colour}">${label}</strong>`);
    expect(html).not.toContain("<svg");
  });
});

describe("DateField", () => {
  it("shows an ISO value as DD.MM.YYYY in a text input", () => {
    const html = render(<DateField id="d" name="data" value="2020-02-29" required />);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*name="data"[^>]*value="29\.02\.2020"/);
    expect(html).toContain('placeholder="ZZ.LL.AAAA"');
    expect(html).not.toContain("inputmode");
    expect(html).toContain("required");
  });

  it("is tied to its hint, and to its message when invalid, and leaves the checking to the server", () => {
    const plain = render(<DateField id="d" name="data" value="2020-02-29" />);
    expect(plain).toContain('aria-describedby="d-hint"');
    expect(plain).not.toContain("aria-invalid");
    expect(plain).not.toContain("pattern=");
    expect(plain).not.toContain("title=\"ZZ");
    const invalid = render(<DateField id="d" name="data" value={null} typed="ieri" invalid />);
    expect(invalid).toContain('aria-describedby="d-hint d-error"');
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('value="ieri"');
  });

  it("is empty without a value", () => {
    const html = render(<DateField id="d" name="de" value={null} />);
    expect(html).not.toContain("value=");
  });

  it("has a hidden calendar button that opens an unnamed native picker", () => {
    const html = render(<DateField id="d" name="data" value="2020-02-29" />);
    expect(html).toMatch(/^<div class="date-input"><input class="field date" id="d"/);
    expect(html).toContain('<input class="date-picker" type="date" tabindex="-1" aria-hidden="true"');
    expect(html).not.toMatch(/type="date"[^>]*name=/);
    const button = /<button[^>]*>/.exec(html)![0];
    expect(button).toContain('type="button"');
    expect(button).toContain(" hidden");
    expect(button).toContain('aria-label="Alege din calendar"');
    expect(button).toContain('data-calendar="d"');
    expect(button).toContain('class="date-open"');
    expect(html).not.toMatch(/class="[^"]*\bcalendar\b/);
  });
});

describe("DateHint, FieldError and ErrorSummary", () => {
  it("shows the example format under the id the field points to", () => {
    expect(render(<DateHint id="d" />)).toBe('<p class="hint" id="d-hint">De exemplu, 13.03.2021</p>');
  });

  it("puts the message under the id the field points to, with the word Eroare for screen readers", () => {
    expect(render(<FieldError id="d">Scrie o zi</FieldError>)).toBe(
      '<p class="error-message" id="d-error"><span class="vh">Eroare: </span>Scrie o zi</p>',
    );
  });

  it("lists each problem as a link to its field under the title", () => {
    expect(render(<ErrorSummary items={[{ href: "#a", text: "Unu" }, { href: "#b", text: "Doi" }]} />)).toBe(
      '<div class="error-summary" role="alert"><h2>Există o problemă</h2><ul><li><a href="#a">Unu</a></li><li><a href="#b">Doi</a></li></ul></div>',
    );
  });
});

describe("DatedNote", () => {
  it("names the way back with the standard words unless told otherwise", () => {
    expect(render(<DatedNote date="2020-01-01" exit="/x" />)).toContain('<a href="/x">Înapoi la forma actuală</a>');
    expect(render(<DatedNote date="2020-01-01" exit="/x" exitLabel="Înapoi la legislația de azi" />)).toContain(
      '<a href="/x">Înapoi la legislația de azi</a>',
    );
  });
});

describe("LawLink", () => {
  it("links an act and a decision to their pages", () => {
    expect(render(<LawLink lawKey="legea-200-2023" label="Legea nr. 200/2023" />)).toBe('<a href="/lege/2023/200">Legea nr. 200/2023</a>');
    expect(render(<LawLink lawKey="dcc-1-2020" label="Decizia 1/2020" />)).toBe('<a href="/jurisprudenta/ccr/2020/1">Decizia 1/2020</a>');
  });

  it("says that the source names no act, and never prints the label, when the key has no page", () => {
    for (const key of ["", "portal", "unexplained"]) {
      const html = render(<LawLink lawKey={key} label="Portalul legislativ (Ministerul Justiției)" />);
      expect(html).toBe('<a href="/despre#sursa">act nemenționat de sursă</a>');
      expect(lawLabelText(key, "unexplained")).toBe("act nemenționat de sursă");
    }
    expect(lawLabelText("legea-1-2020", "Legea nr. 1/2020")).toBe("Legea nr. 1/2020");
  });
});

describe("PageNumbers", () => {
  const href = (n: number) => `/x?pagina=${n}`;

  it("shows nothing for a single page", () => {
    expect(render(<PageNumbers current={1} pages={1} href={href} />)).toBe("");
  });

  it("numbers every page of a short list, marks the current one and shows the step that leads nowhere as disabled", () => {
    const html = render(<PageNumbers current={1} pages={3} href={href} />);
    expect(html).toContain('<nav class="page-numbers" aria-label="Paginile listei">');
    expect(html).toContain('<span class="page-current" aria-label="Pagina 1" aria-current="page">1</span>');
    expect(html).not.toContain('<a href="/x?pagina=1"');
    expect(html).toMatch(/<li class="page-step"><span class="off" aria-disabled="true"><svg [^>]*>[^]*?<\/svg>Pagina anterioară<\/span><\/li>/);
    expect(html).toContain('<a href="/x?pagina=3" aria-label="Pagina 3">3</a>');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).not.toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).not.toContain("page-gap");
    const end = render(<PageNumbers current={3} pages={3} href={href} />);
    expect(end).toMatch(/<span class="off" aria-disabled="true">Pagina următoare<svg/);
    expect(end).not.toContain('rel="next"');
  });

  it("keeps the ends and the neighbours of a long list and marks the gaps", () => {
    const html = render(<PageNumbers current={10} pages={31} href={href} />);
    const shown = [...html.matchAll(/aria-label="Pagina (\d+)"/g)].map((m) => Number(m[1]));
    expect(shown).toEqual([1, 9, 10, 11, 31]);
    expect(html.match(/class="page-gap" aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain('<a href="/x?pagina=9" rel="prev">');
    expect(html).toContain('<a href="/x?pagina=11" rel="next">');
    const near = render(<PageNumbers current={2} pages={31} href={href} />);
    expect([...near.matchAll(/aria-label="Pagina (\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 31]);
    expect(near.match(/page-gap/g)).toHaveLength(1);
  });
});

describe("Options", () => {
  const options = (checked: boolean) =>
    render(
      <Options
        legend="Opțiuni"
        action="/x"
        params={{ cuprins: "a" }}
        options={[
          { param: "atribuire", label: "Legea", checked, on: "1", off: "0", flips: "attr" },
          { param: "doar", label: "Doar", checked, on: "diferente", class: "wide-only" },
        ]}
      />,
    );

  it("is one form of checkboxes that works without JavaScript", () => {
    const html = options(true);
    expect(html).toMatch(/^<form class="options inline" method="get" action="\/x"><input type="hidden" name="cuprins" value="a"\/?>/);
    expect(html).toContain("<fieldset><legend>Opțiuni</legend><div class=\"checkboxes\">");
    expect(html).toContain('<label for="optiune-atribuire">Legea</label>');
    expect(html).toContain('<button class="btn secondary apply" type="submit">Aplică</button>');
    expect(html).not.toContain('role="switch"');
  });

  it("reflects the state of each option", () => {
    expect(options(true).match(/ checked=""/g)).toHaveLength(2);
    expect(options(false)).not.toContain("checked");
  });

  it("sends the off value of an option after its box, so that a ticked box comes first", () => {
    const html = options(false);
    expect(html).toMatch(/name="atribuire" value="1"[^>]*><label[^>]*>Legea<\/label><\/div><input type="hidden" name="atribuire" value="0"/);
    expect(html).not.toContain('type="hidden" name="doar"');
  });

  it("tells the script which parameter each box sets, what it holds on and off, and what it flips", () => {
    const html = options(true);
    expect(html).toContain('data-param="atribuire" data-on="1" data-off="0" data-flips="attr"');
    expect(html).toContain('data-param="doar" data-on="diferente" data-off=""');
    expect(html).toMatch(/<div class="checkbox wide-only"><input id="optiune-doar"/);
    expect(html.match(/data-flips/g)).toHaveLength(1);
  });
});

describe("Panel, SummaryList, Inset, WarningText, Breadcrumbs, Tabs, Pagination, DataTable", () => {
  it("puts the heading at the top of a rail section", () => {
    const html = render(<Panel title="Citare">x</Panel>);
    expect(html).toMatch(/<section class="panel"><h2>Citare<\/h2>x<\/section>/);
  });

  it("lists key-value rows as a summary list", () => {
    const html = render(<SummaryList rows={[{ label: "Emitent", value: "Parlamentul" }]} />);
    expect(html).toBe(
      '<dl class="summary"><div class="summary-row"><dt class="summary-key">Emitent</dt><dd class="summary-value">Parlamentul</dd></div></dl>',
    );
  });

  it("renders inset text and warning text with a hidden word for screen readers", () => {
    expect(render(<Inset>Note</Inset>)).toBe('<div class="inset">Note</div>');
    const warning = render(<WarningText>Careful</WarningText>);
    expect(warning).toBe('<div class="warning"><strong class="warning-text"><span class="vh">Atenție: </span>Careful</strong></div>');
  });

  it("ends the breadcrumbs with the current page as plain text", () => {
    const html = render(<Breadcrumbs items={[{ href: "/", label: "Acasă" }]} current="Modificări" />);
    expect(html).toContain('<ol><li><a href="/">Acasă</a></li><li aria-current="page">Modificări</li></ol>');
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });

  it("lists the breadcrumbs in order", () => {
    const html = render(
      <Breadcrumbs items={[{ href: "/", label: "Acasă" }, { href: "/codul-civil", label: "Codul civil" }]} />,
    );
    expect(html).toBe(
      '<nav class="crumbs" aria-label="Cale de navigare"><ol><li><a href="/">Acasă</a></li><li><a href="/codul-civil">Codul civil</a></li></ol></nav>',
    );
  });

  it("marks the selected tab and names the panel a tab can switch", () => {
    const html = render(
      <Tabs
        label="Secțiuni"
        tabs={[
          { href: "/a", label: "A", current: true, panel: "pa" },
          { href: "/b", label: "B", current: false },
        ]}
      />,
    );
    expect(html).toContain('<nav class="tabs" aria-label="Secțiuni"><ul class="tabs-list">');
    expect(html).toContain('<li class="tabs-item selected"><a href="/a" aria-current="page" data-panel="pa" data-text="A">A</a></li>');
    expect(html).toContain('<li class="tabs-item"><a href="/b" data-text="B">B</a></li>');
  });

  it("renders the previous and next links only when present", () => {
    const both = render(
      <Pagination
        prev={{ href: "/p", title: "Art. 1" }}
        next={{ href: "/n", title: "Art. 3" }}
      />,
    );
    expect(both).toContain('<a href="/p" rel="prev">');
    expect(both).toContain('<a href="/n" rel="next">');
    expect(both).toContain("Anterior</span>");
    expect(both).toContain('<span class="pagination-label">Art. 3</span>');
    const onlyNext = render(<Pagination next={{ href: "/n", title: "Art. 3" }} />);
    expect(onlyNext).not.toContain('href="/p"');
    const captioned = render(
      <Pagination label="Pages" captions={{ prev: "Earlier", next: "Later" }} next={{ href: "/n", title: "2" }} />,
    );
    expect(captioned).toContain('aria-label="Pages"');
    expect(captioned).toContain("Later<svg");
  });

  it("renders header cells and rows", () => {
    const html = render(
      <DataTable head={["Data", "Act"]} rows={[["01.01.2020", "Legea 1/2020"]]} />,
    );
    expect(html).toContain('<th scope="col">Data</th>');
    expect(html).toContain('<td data-label="Act">Legea 1/2020</td>');
    expect(html).toMatch(/^<div class="table-wrap"><table class="data stack">/);
  });
});

describe("Timeline", () => {
  const point = (date: string) => ({ date, href: `/v/${date}`, name: `Version ${date}` });
  const base = [point("2011-10-01"), point("2016-10-19"), point("2021-03-13"), point("2027-01-01")];
  const today = "2026-11-08";

  it("links every point with an accessible name", () => {
    const html = render(<Timeline today={today} points={base} current="2021-03-13" />);
    for (const p of base.filter((q) => q.date !== "2021-03-13")) {
      expect(html).toContain(`href="/v/${p.date}"`);
      expect(html).toContain(`aria-label="${formatRo(p.date)}, Version ${p.date}`);
    }
    expect(html.match(/<a\b/g)).toHaveLength(3);
  });

  it("shows the point of the shown version as a mark, not a link to itself", () => {
    const html = render(<Timeline today={today} points={base} current="2021-03-13" pick />);
    expect(html).toContain('<span class="pt cur" aria-current="true"><span class="vh">versiunea afișată</span></span>');
    expect(html).toContain('<span class="now" aria-hidden="true">versiunea afișată</span>');
    expect(html).not.toContain('href="/v/2021-03-13"');
    expect(html).toContain("13.03.2021");
    expect(html).toContain("versiunea afișată");
    expect(html.match(/data-pick/g)).toHaveLength(3);
  });

  it("shows the act of each point as text for the phone list", () => {
    const html = render(<Timeline today={today} points={base} current="2021-03-13" />);
    expect(html.match(/<span class="act">Version \d{4}-\d\d-\d\d<\/span>/g)).toHaveLength(4);
    const bare = render(
      <Timeline today={today} points={[{ date: "2020-01-01", href: "/v", name: "" }]} />,
    );
    expect(bare).not.toContain('class="act"');
  });

  it("marks the current and future points", () => {
    const html = render(<Timeline today={today} points={base} current="2021-03-13" />);
    expect(html.match(/class="pt cur"/g)).toHaveLength(1);
    expect(html.match(/class="pt fut"/g)).toHaveLength(1);
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(render(<Timeline today={today} points={base} from="2016-10-19" to="2021-03-13" />)).not.toContain("aria-current");
  });

  it("marks the ends of a compared range", () => {
    const html = render(
      <Timeline today={today} points={base} from="2016-10-19" to="2021-03-13" />,
    );
    expect(html.match(/class="pt rng"/g)).toHaveLength(2);
    expect(html).toContain('class="span"');
  });

  it("swaps a reversed range", () => {
    const html = render(
      <Timeline today={today} points={base} from="2021-03-13" to="2016-10-19" />,
    );
    expect(html.match(/class="pt rng"/g)).toHaveLength(2);
    expect(html).toMatch(/class="span" style="left:[\d.]+%;width:[\d.]+%"/);
    expect(html).not.toContain("width:-");
  });

  it("sorts points by date and positions them from the dates", () => {
    const html = render(
      <Timeline
        today={today}
        points={[base[2]!, base[0]!, base[1]!, base[3]!]}
        current="2021-03-13"
      />,
    );
    expect(html.indexOf("/v/2011-10-01")).toBeLessThan(html.indexOf("/v/2016-10-19"));
    expect(html.indexOf("/v/2016-10-19")).toBeLessThan(html.indexOf("/v/2027-01-01"));
    expect(html).toContain("left:4%");
    expect(html).toContain("left:96%");
  });

  it("spaces two close points evenly and labels every one", () => {
    const close = [point("2020-01-01"), point("2020-01-10"), point("2030-01-01")];
    const html = render(<Timeline today={today} points={close} current="2020-01-01" />);
    expect(html).toContain('<nav class="track even"');
    expect(html).toContain('<div class="track-in" style="min-width:22.5em">');
    expect(html.match(/class="lbl(?: cur)?"/g)).toHaveLength(3);
    expect(html).toContain('<span class="lbl cur">01.01.2020');
    expect(html).toContain('<span class="lbl">10.01.2020');
    expect(html).not.toContain("merged");
    expect(html.match(/<a\b/g)).toHaveLength(2);
    expect(html).toContain('<li class="cur" style="left:16.67%">');
  });

  it("switches to even mode for more than four points, even when they are far apart", () => {
    const seven = Array.from({ length: 7 }, (_, i) => point(`${2000 + i * 3}-01-01`));
    const html = render(<Timeline today={today} points={seven} current="2006-01-01" />);
    expect(html).toContain('<nav class="track even"');
    expect(html).toContain('style="min-width:52.5em"');
    expect(html.match(/class="lbl(?: cur)?"/g)).toHaveLength(7);
    expect(html.match(/<a\b/g)).toHaveLength(6);
    expect(render(<Timeline today={today} points={seven.slice(0, 5)} />)).toContain('<nav class="track even"');
    const four = render(<Timeline today={today} points={seven.slice(0, 4)} />);
    expect(four).toContain('<nav class="track" ');
    expect(four).not.toContain("track-in");
  });

  it("keeps the proportional track only for few points a fifth of the track apart", () => {
    const html = render(<Timeline today={today} points={base} current="2021-03-13" />);
    expect(html).toContain('<nav class="track" ');
    expect(html).not.toContain("even");
    expect(html).not.toContain("track-in");
    expect(html.match(/class="lbl(?: cur)?"/g)).toHaveLength(4);
    const near = [point("2011-10-01"), point("2014-10-19"), point("2021-03-13"), point("2027-01-01")];
    expect(render(<Timeline today={today} points={near} />)).toContain('<nav class="track even"');
    const three = [point("2010-01-01"), point("2015-01-01"), point("2020-01-01")];
    const spread = render(<Timeline today={today} points={three} />);
    expect(spread).toContain('<nav class="track" ');
    expect(spread).toContain("left:4%");
    expect(spread).toContain("left:50%");
  });

  it("captions the shown version and marks its row, ending the captions at a point near the right end", () => {
    const html = render(<Timeline today={today} points={base} current="2027-01-01" />);
    expect(html.match(/<span class="now" aria-hidden="true">versiunea afișată<\/span>/g)).toHaveLength(1);
    expect(html).toContain('<li class="cur end" style="left:96%">');
    const middle = render(<Timeline today={today} points={base} current="2021-03-13" />);
    expect(middle).toContain('<li class="cur" style="left:');
    const early = render(<Timeline today={today} points={base} current="2011-10-01" />);
    expect(early).toContain('<li class="cur start" style="left:4%">');
    expect(html).toContain('<li class="start" style="left:4%">');
    const range = render(<Timeline today={today} points={base} from="2016-10-19" to="2027-01-01" />);
    expect(range.match(/<li class="rng"/g)).toHaveLength(1);
    expect(range).toContain('<li class="rng end" style="left:96%">');
    expect(range).not.toContain('class="now"');
  });
});

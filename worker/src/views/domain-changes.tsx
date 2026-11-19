import { t, tPlural } from "../text";
import type { Key } from "../text";
import { articleLabel } from "../lib/article-label";
import { formatRo } from "../lib/dates";
import type { DomainMonth } from "../lib/domain-changes";
import { type Domain, DOMAINS, domainUrl, monthUrl } from "../lib/domains";
import { unitText } from "../lib/text";
import type { ChangeItem } from "../lib/types";
import { articleUrl } from "../lib/urls";
import { Breadcrumbs } from "./components";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { LawLink, VERBS } from "./shared";

const count = (n: number) =>
  tPlural(n, { one: "changesCountOne", few: "changesCountFew", many: "changesCountMany" });

const MONTHS: Key[] = [
  "dcMonth01",
  "dcMonth02",
  "dcMonth03",
  "dcMonth04",
  "dcMonth05",
  "dcMonth06",
  "dcMonth07",
  "dcMonth08",
  "dcMonth09",
  "dcMonth10",
  "dcMonth11",
  "dcMonth12",
];

export function monthName(month: string): string {
  return t(MONTHS[Number(month.slice(5, 7)) - 1] ?? "dcMonth01");
}

const yearOf = (month: string) => month.slice(0, 4);

const label = (month: string) => `${monthName(month)} ${yearOf(month)}`;

const home = { href: "/", label: t("breadcrumbHome") };
const root = { href: "/ce-s-a-schimbat", label: t("dcTitle") };

export function renderDomainIndex(months: Map<Domain, DomainMonth[]>) {
  return (
    <Layout title={t("dcTitle")} description={t("dcIndexDescription")} canonical={`${ORIGIN}/ce-s-a-schimbat`}>
      <section class="solo">
        <Breadcrumbs items={[home]} current={t("dcTitle")} />
        <h1>{t("dcTitle")}</h1>
        <p>{t("dcIndexIntro")}</p>
        {DOMAINS.map((domain) => {
          const list = months.get(domain) ?? [];
          return (
            <section aria-labelledby={`d-${domain.slug}`}>
              <h2 id={`d-${domain.slug}`}>
                <a href={domainUrl(domain)}>{t(domain.name)}</a>
              </h2>
              {list.length === 0 ? (
                <p>{t("dcNoMonths")}</p>
              ) : (
                <>
                  <p class="hint">{t("dcLatest")}</p>
                  <ul class="plain">
                    {list.slice(0, 3).map((item) => (
                      <li>
                        <a href={monthUrl(domain, item.month)}>{label(item.month)}</a> ({count(item.count)})
                      </li>
                    ))}
                  </ul>
                  <p>
                    <a href={domainUrl(domain)}>{t("dcAllMonths")}</a>
                  </p>
                </>
              )}
            </section>
          );
        })}
      </section>
    </Layout>
  );
}

export function renderDomainPage(domain: Domain, months: DomainMonth[]) {
  const phrase = t(domain.phrase);
  const title = t("dcDomainTitle", { phrase });
  const total = months.reduce((sum, item) => sum + item.count, 0);
  return (
    <Layout
      title={title}
      description={t("dcDomainDescription", { phrase, count: count(total) })}
      canonical={`${ORIGIN}${domainUrl(domain)}`}
    >
      <section class="solo">
        <Breadcrumbs items={[home, root]} current={t(domain.name)} />
        <h1>{title}</h1>
        <ul class="plain">
          {months.map((item) => (
            <li>
              <a href={monthUrl(domain, item.month)}>{label(item.month)}</a> ({count(item.count)})
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}

function ItemLine({ item, actRef }: { item: ChangeItem; actRef: string }) {
  const units = item.units.map((id) => unitText(id)).join(", ");
  return (
    <li>
      <a href={articleUrl(actRef, item, item.date)}>
        <Indexed text={articleLabel(item)} />
        {item.title ? ` ${item.title}` : ""}
      </a>
      {": "}
      <span class="verb">{t(VERBS[item.verb])}</span>
      {units !== "" && <Indexed text={` ${units}`} />}
    </li>
  );
}

function byLaw(items: ChangeItem[]): { id: string; law: ChangeItem["law"]; date: string; items: ChangeItem[] }[] {
  const groups: { id: string; law: ChangeItem["law"]; date: string; items: ChangeItem[] }[] = [];
  for (const item of items) {
    const id = `${item.law?.key ?? ""}|${item.date}`;
    let group = groups.find((candidate) => candidate.id === id);
    if (group === undefined) groups.push((group = { id, law: item.law, date: item.date, items: [] }));
    group.items.push(item);
  }
  return groups;
}

export interface MonthNav {
  previous: string | null;
  next: string | null;
}

export function renderDomainMonth(domain: Domain, data: DomainMonth, nav: MonthNav) {
  const phrase = t(domain.phrase);
  const month = monthName(data.month);
  const year = yearOf(data.month);
  const title = t("dcMonthTitle", { phrase, month, year });
  const acts = tPlural(data.acts.length, { one: "dcActsCountOne", few: "dcActsCountMany", many: "dcActsCountMany" });
  return (
    <Layout
      title={title}
      description={t("dcMonthDescription", { phrase, month, year, count: count(data.count), acts })}
      canonical={`${ORIGIN}${monthUrl(domain, data.month)}`}
    >
      <section class="solo wide">
        <Breadcrumbs
          items={[home, root, { href: domainUrl(domain), label: t(domain.name) }]}
          current={label(data.month)}
        />
        <h1>{title}</h1>
        <p>{t("dcMonthIntro", { month, year })}</p>
        {data.acts.map(({ act, items }) => (
          <section aria-labelledby={`a-${act.ref.replace(/\W/g, "-")}`}>
            <h2 id={`a-${act.ref.replace(/\W/g, "-")}`}>
              <a href={`/${act.ref}`}>{act.name}</a> <span class="count">({count(items.length)})</span>
            </h2>
            {byLaw(items).map((group) => (
              <>
                <h3>
                  {formatRo(group.date)}
                  {": "}
                  {group.law === null ? (
                    t("lawUnnamed")
                  ) : (
                    <LawLink lawKey={group.law.key} label={group.law.label} />
                  )}
                </h3>
                <ul>
                  {group.items.map((item) => (
                    <ItemLine item={item} actRef={act.ref} />
                  ))}
                </ul>
              </>
            ))}
          </section>
        ))}
        <nav class="pagination" aria-label={t("dcMonthsNav")}>
          {nav.previous !== null && (
            <a rel="prev" href={monthUrl(domain, nav.previous)}>
              {t("dcPrevious", { month: monthName(nav.previous), year: yearOf(nav.previous) })}
            </a>
          )}
          {nav.next !== null && (
            <a rel="next" href={monthUrl(domain, nav.next)}>
              {t("dcNext", { month: monthName(nav.next), year: yearOf(nav.next) })}
            </a>
          )}
        </nav>
      </section>
    </Layout>
  );
}

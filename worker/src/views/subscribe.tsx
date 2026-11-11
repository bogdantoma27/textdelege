import { t } from "../text";
import { FEED_LIMIT } from "../lib/change-filter";
import { Breadcrumbs } from "./components";
import { Layout, ORIGIN } from "./layout";

export interface SubscribePage {
  path: string;
  scope: string;
  subject: string;
  changes: string;
  feed: string;
}

export function renderSubscribe(page: SubscribePage) {
  return (
    <Layout title={t("subscribeTitle")} description={t("subscribeLead")} canonical={`${ORIGIN}${page.path}`} noindex>
      <section class="solo doc">
        <Breadcrumbs
          items={[
            { href: "/", label: t("breadcrumbHome") },
            { href: page.changes, label: page.scope },
          ]}
          current={t("subscribeTitle")}
        />
        <h1>{t("subscribeTitle")}</h1>
        <p>{t("subscribeLead")}</p>
        <p>
          <strong>{t("subscribeFollows", { subject: page.subject })}</strong>
        </p>
        <h2>{t("subscribeAddressHeading")}</h2>
        <p class="feed-addr">{page.feed}</p>
        <p class="cite-links">
          <button class="btn" type="button" data-copy={page.feed} data-copied={t("citeCopied")} data-failed={t("citeCopyFailed")}>
            {t("subscribeCopy")}
          </button>
          <span class="copied" role="status" />
        </p>
        <h2>{t("subscribeStepsHeading")}</h2>
        <ol>
          <li>{t("subscribeStepReader")}</li>
          <li>{t("subscribeStepAdd")}</li>
          <li>{t("subscribeStepPaste")}</li>
        </ol>
        <h2>{t("subscribeWhatHeading")}</h2>
        <p>{t("subscribeWhatText", { n: FEED_LIMIT })}</p>
        <p>{t("subscribeRawNote")}</p>
      </section>
    </Layout>
  );
}

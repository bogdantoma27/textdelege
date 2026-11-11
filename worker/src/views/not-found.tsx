import { t } from "../text";
import { SITE_REPOSITORY } from "../lib/urls";
import { Breadcrumbs } from "./components";
import { Layout, ORIGIN, SearchForm } from "./layout";

export function NotFound({ path, message }: { path: string; message?: string }) {
  return (
    <Layout title={t("notFoundTitle")} canonical={`${ORIGIN}${path}`} noindex>
      <section class="solo">
        <Breadcrumbs items={[{ href: "/", label: t("breadcrumbHome") }]} current={t("notFoundTitle")} />
        <h1>{t("notFoundTitle")}</h1>
        <p>{message ?? t("notFoundText")}</p>
        <p class="asked">
          {t("notFoundAsked")}: <code>{path}</code>
        </p>
        <SearchForm id="q-page" class="omni page-search" />
        <ul class="plain">
          <li>
            <a href="/#coduri">{t("navCodes")}</a>
          </li>
          <li>
            <a href="/modificari">{t("navChanges")}</a>
          </li>
          <li>
            <a href="/legislatie">{t("footerPointInTime")}</a>
          </li>
          <li>
            <a href="/despre">{t("aboutTitle")}</a>
          </li>
        </ul>
        <p>
          <a href={`${SITE_REPOSITORY}/issues/new`}>{t("notFoundReport")}</a>
        </p>
      </section>
    </Layout>
  );
}

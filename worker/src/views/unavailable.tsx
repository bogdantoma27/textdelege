import { t } from "../text";
import { Breadcrumbs } from "./components";
import { Layout, ORIGIN } from "./layout";

export function Unavailable({ path }: { path: string }) {
  return (
    <Layout title={t("unavailableTitle")} canonical={`${ORIGIN}${path}`} noindex>
      <section class="solo">
        <Breadcrumbs items={[{ href: "/", label: t("breadcrumbHome") }]} />
        <h1>{t("unavailableTitle")}</h1>
        <p>{t("unavailableText")}</p>
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
      </section>
    </Layout>
  );
}

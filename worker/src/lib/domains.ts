import type { Key } from "../text";

export interface Domain {
  slug: string;
  /** Short name, e.g. "Fiscal". */
  name: Key;
  /** Noun phrase used in titles, e.g. "legislația fiscală". */
  phrase: Key;
  /** Paths of the acts whose changes the domain pages list; acts missing from the data are skipped. */
  acts: readonly string[];
}

export const DOMAINS: readonly Domain[] = [
  { slug: "fiscal", name: "dcDomainFiscal", phrase: "dcPhraseFiscal", acts: ["lege/2015/227", "lege/2015/207"] },
  { slug: "munca", name: "dcDomainMunca", phrase: "dcPhraseMunca", acts: ["lege/2003/53", "lege/2022/367"] },
  {
    slug: "societati",
    name: "dcDomainSocietati",
    phrase: "dcPhraseSocietati",
    acts: ["lege/1990/31", "lege/2014/85", "lege/2022/265"],
  },
];

export const findDomain = (slug: string): Domain | undefined => DOMAINS.find((domain) => domain.slug === slug);

export const domainUrl = (domain: Domain): string => `/ce-s-a-schimbat/${domain.slug}`;

export const monthUrl = (domain: Domain, month: string): string => `${domainUrl(domain)}/${month.replace("-", "/")}`;

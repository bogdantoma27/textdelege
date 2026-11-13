const LABELS: Record<string, string> = {
  legea: "Legea",
  oug: "OUG",
  og: "OG",
  hg: "HG",
  "decret-lege": "Decretul-lege",
  decret: "Decretul",
  dcc: "Decizia Curții Constituționale",
  "rectificare-mo": "Rectificarea din Monitorul Oficial",
};

const KEY = /^(legea|oug|og|hg|decret-lege|decret|dcc|rectificare-mo)-(\d+)-(\d{4})$/;

export function labelFromKey(key: string): string {
  const match = KEY.exec(key);
  return match ? `${LABELS[match[1]!]} nr. ${match[2]}/${match[3]}` : key;
}

/** False for source notes that name no act, such as "amending acts named in the act's README.md". */
export function namesAnAct(label: string): boolean {
  return /\d/.test(label);
}

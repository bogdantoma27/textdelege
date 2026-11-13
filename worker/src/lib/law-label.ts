const LABELS: Record<string, string> = {
  legea: "Legea",
  oug: "OUG",
  og: "OG",
  hg: "HG",
  "decret-lege": "Decretul-lege",
  decret: "Decretul",
};

const KEY = /^(legea|oug|og|hg|decret-lege|decret)-(\d+)-(\d{4})$/;

export function labelFromKey(key: string): string {
  const match = KEY.exec(key);
  return match ? `${LABELS[match[1]!]} nr. ${match[2]}/${match[3]}` : key;
}

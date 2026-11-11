import { strings } from "./strings";

export type Key = keyof typeof strings;

const GENITIVE: [RegExp, string][] = [
  [/^Codul\b/, "Codului"],
  [/^Constituția\b/, "Constituției"],
  [/^Legea\b/, "Legii"],
  [/^Ordonanța\b/, "Ordonanței"],
  [/^Hotărârea\b/, "Hotărârii"],
  [/^Decretul\b/, "Decretului"],
  [/^Regulamentul\b/, "Regulamentului"],
];

export function genitive(name: string): string {
  for (const [pattern, form] of GENITIVE) {
    if (pattern.test(name)) return name.replace(pattern, form);
  }
  return name;
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  const text: string = strings[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in vars ? String(vars[name]) : placeholder,
  );
}

export type PluralForm = "one" | "few" | "many";

export function pluralForm(n: number): PluralForm {
  if (n === 1) return "one";
  const rest = n % 100;
  return n === 0 || (rest >= 1 && rest <= 19) ? "few" : "many";
}

export function tPlural(
  n: number,
  keys: Record<PluralForm, Key>,
  vars?: Record<string, string | number>,
): string {
  return t(keys[pluralForm(n)], { n, ...vars });
}

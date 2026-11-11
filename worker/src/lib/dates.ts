const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const match = ISO.exec(s);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const RO = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export function parseDate(input: string): string | null {
  const text = input.trim();
  if (isIsoDate(text)) return text;
  const match = RO.exec(text);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

export function formatRo(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
}

export function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function dayAfter(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

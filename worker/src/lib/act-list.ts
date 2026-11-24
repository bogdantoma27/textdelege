const DESIGNATION = /^.*?\bnr\.\s*[0-9][0-9.]*\/[0-9]{4}\s*/;

/** "Codul muncii (Legea nr. 53/2003)" -> "Legea nr. 53/2003"; a bare "Legea nr. 53/2003" title also counts. Null without a short name or a designation. */
export function actDesignation(title: string, short: string | null): string | null {
  if (short === null) return null;
  const clean = title.trim();
  const paren = /\(([^()]+)\)\s*$/.exec(clean)?.[1]?.trim();
  if (paren) return paren;
  return clean !== short.trim() && /\bnr\.\s*[0-9][0-9.]*\/[0-9]{4}/.test(clean) ? clean : null;
}

/** "Legea nr. 10/2001 privind regimul" -> "Legea nr. 10/2001"; a title without a designation stays whole. */
export function titleDesignation(title: string): string {
  return /^.*?\bnr\.\s*[0-9][0-9.]*\/[0-9]{4}/.exec(title.trim())?.[0] ?? title.trim();
}

/** What an act is about, without the designation the link already says: null when nothing is left. */
export function actSubject(title: string, short: string | null): string | null {
  const link = (short ?? title).trim();
  const clean = title.trim();
  const paren = /^(.+?)\s+\((.+)\)$/.exec(clean);
  let subject: string;
  if (short !== null && paren !== null && paren[1] === short.trim()) subject = paren[2]!.trim();
  else if (DESIGNATION.test(clean)) subject = clean.replace(DESIGNATION, "").trim();
  else subject = clean;
  return subject === "" || subject === link ? null : subject;
}

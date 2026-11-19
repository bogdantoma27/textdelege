const DESIGNATION = /^.*?\bnr\.\s*[0-9][0-9.]*\/[0-9]{4}\s*/;

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

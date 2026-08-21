/** Strip markup so HUD / chat never renders HTML paste artifacts. */
export function sanitizeText(raw: unknown, max = 120): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&[#a-zA-Z0-9]+;/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function looksLikeMarkup(raw: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(raw) || /&[#a-zA-Z0-9]+;/.test(raw);
}

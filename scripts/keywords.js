/*
 * Shared keyword matching: Restock's include/exclude filters and the Buy
 * List's keyword fallback (F2) use the same rules. Added in 0.6.0.
 *
 * F3: two match modes, chosen per shop.
 *  - "substring" (the original behaviour, and the default): the keyword can
 *    appear anywhere in the name ("oil" matches "Oil of Taggit" and "Boil").
 *  - "word": the keyword must be a whole word. Hyphens and apostrophes count
 *    as part of a word, so "arrow" no longer matches "Arrow-Catching Shield".
 *    Plurals are separate words: use "arrows" for "Arrows (20)".
 */

export function parseKeywords(text) {
  return (text || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keywordMatches(name, keyword, mode = "substring") {
  const haystack = (name || "").toLowerCase();
  if (mode !== "word") return haystack.includes(keyword);
  // Word characters: letters, digits, hyphen, apostrophes. Anything else is a boundary.
  return new RegExp(`(^|[^\\p{L}\\p{N}'’-])${escapeRegExp(keyword)}($|[^\\p{L}\\p{N}'’-])`, "u").test(haystack);
}

/** True if `name` passes an include list (empty = no restriction) and hits
 *  nothing on an exclude list. */
export function passesKeywords(name, includeText, excludeText, mode = "substring") {
  const include = parseKeywords(includeText);
  const exclude = parseKeywords(excludeText);
  if (include.length && !include.some((kw) => keywordMatches(name, kw, mode))) return false;
  if (exclude.length && exclude.some((kw) => keywordMatches(name, kw, mode))) return false;
  return true;
}

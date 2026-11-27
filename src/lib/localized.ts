import type { LangMap, VocabTerm } from "@/types/registry";

/**
 * Helpers for language-tagged vocabulary content (labels, definitions).
 *
 * Vocabulary files publish translations as JSON-LD language maps
 * ("label": {"en": "…", "de": "…"}, i.e. `@container: @language`) or as
 * {"@language", "@value"} literals. The parser normalises both into a
 * `LangMap`; everything here works on that normalised form.
 *
 * Note this is the language of the *content*, deliberately separate from
 * the UI language (react-i18next): the UI ships English only, but a
 * vocabulary may well be translated into German, French, Italian….
 */

/** Tag used for literals that carry no language at all. */
export const UNDETERMINED = "und";

/** Language we fall back to when nothing in the user's preference list is available. */
export const DEFAULT_CONTENT_LANGUAGE = "en";

// Primary language subtag (2–3 letters) plus optional script/region/variant
// subtags: matches "de", "fr", "de-ch", "zh-hans". Deliberately strict so an
// arbitrary object key is not mistaken for a language tag.
const LANG_TAG = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/;

/**
 * Normalises a language tag to lower case ("de-CH" -> "de-ch").
 * Returns UNDETERMINED for "@none"/empty, and undefined if it is not a valid tag.
 */
export function normalizeLangTag(tag: unknown): string | undefined {
  if (typeof tag !== "string") return undefined;
  const t = tag.trim().toLowerCase().replace(/_/g, "-");
  if (t === "" || t === "@none" || t === UNDETERMINED) return UNDETERMINED;
  return LANG_TAG.test(t) ? t : undefined;
}

/** "de-ch" -> "de". */
export function baseLanguage(tag: string): string {
  return tag.split("-")[0];
}

/** Merges language maps; where several define the same language, the earlier map wins. */
export function mergeLangMaps(...maps: (LangMap | undefined)[]): LangMap {
  const out: LangMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [lang, text] of Object.entries(map)) {
      if (!(lang in out)) out[lang] = text;
    }
  }
  return out;
}

export interface LocalizedText {
  text: string;
  /** Language the text is actually in; undefined when the source literal carried no language tag. */
  lang?: string;
}

/**
 * Picks the best text for an ordered list of preferred languages.
 *
 * Per preferred language: exact tag, then its base language ("de-ch" -> "de"),
 * then any regional variant ("de" -> "de-ch"). If none of them is available:
 * English, then untagged text, then simply the first entry.
 */
export function pickLocalized(map: LangMap | undefined, preferred: readonly string[]): LocalizedText | undefined {
  if (!map) return undefined;
  const keys = Object.keys(map);
  if (keys.length === 0) return undefined;

  const hit = (key: string): LocalizedText => ({ text: map[key], lang: key === UNDETERMINED ? undefined : key });

  for (const raw of preferred) {
    const tag = normalizeLangTag(raw);
    if (!tag || tag === UNDETERMINED) continue;
    if (tag in map) return hit(tag);
    const base = baseLanguage(tag);
    if (base in map) return hit(base);
    const variant = keys.find((k) => baseLanguage(k) === base);
    if (variant) return hit(variant);
  }
  for (const fallback of [DEFAULT_CONTENT_LANGUAGE, UNDETERMINED]) {
    if (fallback in map) return hit(fallback);
  }
  return hit(keys[0]);
}

/** Every real language (not "und") used across the given maps, sorted. */
export function languagesIn(...maps: (LangMap | undefined)[]): string[] {
  const langs = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    for (const lang of Object.keys(map)) if (lang !== UNDETERMINED) langs.add(lang);
  }
  return Array.from(langs).sort();
}

/**
 * Builds the ordered list of languages to try: an explicit choice (e.g. from
 * `?lng=de`) first, then the browser's own preference list.
 */
export function resolvePreferredLanguages(
  explicit: string | null | undefined,
  browserLanguages: readonly string[] = []
): string[] {
  const out: string[] = [];
  for (const candidate of [explicit, ...browserLanguages]) {
    const tag = normalizeLangTag(candidate);
    if (tag && tag !== UNDETERMINED && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Human-readable language name ("de" -> "Deutsch" when shown in German); falls back to the raw tag. */
export function describeLanguage(tag: string, inLanguage = "en"): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language" }).of(tag);
    return name && name !== tag ? name : tag;
  } catch {
    return tag;
  }
}

export interface LocalizedTerm {
  label: LocalizedText;
  description?: LocalizedText;
}

/** Resolves a term's label and description for the given preferred languages, falling back to the parser's default-language values. */
export function localizeTerm(
  term: Pick<VocabTerm, "label" | "description" | "labels" | "descriptions">,
  preferred: readonly string[]
): LocalizedTerm {
  const label = pickLocalized(term.labels, preferred) ?? { text: term.label };
  const fromMap = pickLocalized(term.descriptions, preferred);
  const description = fromMap ?? (term.description ? { text: term.description } : undefined);
  return { label, description };
}

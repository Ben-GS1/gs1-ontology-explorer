import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { resolvePreferredLanguages } from "@/lib/localized";

/**
 * Query parameter holding an explicit content-language choice, e.g. `?lng=de`.
 * Same name as the one i18next's language detector already reads, so a
 * shared link such as `/rail/geo?lng=de` behaves consistently if a German
 * UI locale is added later.
 */
export const CONTENT_LANG_PARAM = "lng";

/**
 * Ordered languages in which vocabulary content (labels, definitions)
 * should be shown: the explicit `?lng=` choice first, then the browser's
 * own preference list. Falling back to English happens in pickLocalized().
 *
 * This is deliberately independent of the UI language (react-i18next):
 * the UI is English-only today, but a vocabulary can be translated freely.
 */
export function useContentLanguages(): string[] {
  const [params] = useSearchParams();
  const explicit = params.get(CONTENT_LANG_PARAM);
  return useMemo(() => {
    const browser = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
    return resolvePreferredLanguages(explicit, browser.filter(Boolean));
  }, [explicit]);
}

/** Appends the explicit content-language choice to an existing query string ("" or "?a=b"), so it survives navigation between pages. */
export function appendContentLanguage(query: string, explicit: string | null | undefined): string {
  if (!explicit) return query;
  return `${query}${query.includes("?") ? "&" : "?"}${CONTENT_LANG_PARAM}=${encodeURIComponent(explicit)}`;
}

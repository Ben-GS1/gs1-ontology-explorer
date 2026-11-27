import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CONTENT_LANG_PARAM } from "@/hooks/useContentLanguage";
import { describeLanguage } from "@/lib/localized";

/**
 * Lets the reader choose in which language labels and definitions are
 * shown, among the languages the vocabulary actually provides. The choice
 * lives in the URL (`?lng=de`) so it is shareable and survives navigation.
 * Renders nothing when there is nothing to choose between.
 */
export function ContentLanguageSelect({ languages }: { languages: string[] }) {
  const { t, i18n } = useTranslation("common");
  const [params, setParams] = useSearchParams();
  if (languages.length < 2) return null;

  const current = params.get(CONTENT_LANG_PARAM) ?? "";
  const uiLang = i18n.resolvedLanguage ?? "en";

  return (
    <label className="flex items-center gap-2 text-xs text-ink-400">
      <span>{t("term.contentLanguage")}</span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set(CONTENT_LANG_PARAM, e.target.value);
          else next.delete(CONTENT_LANG_PARAM);
          setParams(next, { replace: true });
        }}
        className="rounded border border-ink-100 bg-white px-2 py-1.5 text-xs text-ink-700"
      >
        <option value="">{t("term.languageAuto")}</option>
        {languages.map((lang) => (
          <option key={lang} value={lang}>
            {describeLanguage(lang, uiLang)} ({lang})
          </option>
        ))}
      </select>
    </label>
  );
}

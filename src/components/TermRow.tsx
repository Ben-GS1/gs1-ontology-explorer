import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Artifact, VocabTerm } from "@/types/registry";
import { buildVersionQuery } from "@/lib/registryClient";
import { localizeTerm } from "@/lib/localized";
import { appendContentLanguage, CONTENT_LANG_PARAM, useContentLanguages } from "@/hooks/useContentLanguage";
import { StatusBadge } from "./StatusBadge";

export function TermRow({
  term,
  crossReferencedDomains,
  status = "current",
  versionTag,
}: {
  term: VocabTerm;
  crossReferencedDomains?: string[];
  /** Which state the surrounding list is currently showing — Staging, a specific Deprecated version, etc. Defaults to "current". Threaded into the link so clicking a term never silently drops back to viewing "current". */
  status?: Artifact["status"];
  versionTag?: string;
}) {
  const { t } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const contentLanguages = useContentLanguages();
  const { label, description } = localizeTerm(term, contentLanguages);
  const primaryType = term.types.find((ty) => !ty.startsWith("owl:")) ?? term.types[0];

  return (
    <Link
      to={`/${term.domainSlug}/${term.localName}${appendContentLanguage(
        buildVersionQuery(status, versionTag),
        searchParams.get(CONTENT_LANG_PARAM)
      )}`}
      className="group block rounded border border-ink-100 bg-white px-4 py-3 shadow-card transition hover:border-signal/50"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3
              lang={label.lang}
              className="truncate font-display text-[15px] font-medium text-ink-900 group-hover:text-signal-dim"
            >
              {label.text}
            </h3>
            {term.termStatus === "deprecated" && <StatusBadge status="deprecated" />}
          </div>
          <p className="term-id mt-0.5 truncate text-xs text-ink-400">{term.localName}</p>
          {description && (
            <p lang={description.lang} className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-500">
              {description.text}
            </p>
          )}
        </div>
        {primaryType && (
          <span className="shrink-0 rounded-sm border border-ink-100 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
            {primaryType.replace(/^[a-z]+:/, "")}
          </span>
        )}
      </div>
      {term.unitCode && (
        <p className="term-id mt-1.5 text-[11px] text-ink-400">
          {t("term.unitOfMeasure")}: {term.unitCode}
        </p>
      )}
      {crossReferencedDomains && crossReferencedDomains.length > 1 && (
        <p className="mt-2 text-[11px] text-signal-dim">
          {t("domain.usedInOtherDomains", { domains: crossReferencedDomains.join(", ") })}
        </p>
      )}
    </Link>
  );
}

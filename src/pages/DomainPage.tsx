import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { sectorByCode } from "@/config/sectors";
import { useDomain, useDomainMetadata, useSectors } from "@/hooks/useRegistry";
import { deprecatedVersionTags, loadDomainTerms, versionTagOf } from "@/lib/registryClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ArtifactList } from "@/components/ArtifactList";
import { TermRow } from "@/components/TermRow";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import type { Artifact, DomainEntry } from "@/types/registry";

function useDomainTermsForStatus(domain: DomainEntry | undefined, status: Artifact["status"], versionTag?: string) {
  return useQuery({
    queryKey: ["domain-terms", domain?.slug, status, versionTag],
    queryFn: () => loadDomainTerms(domain as DomainEntry, status, versionTag),
    enabled: Boolean(domain),
    staleTime: 5 * 60 * 1000,
  });
}

export function DomainPage() {
  const { domainSlug = "" } = useParams();
  const { t } = useTranslation(["common", "sectors", "errors"]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Artifact["status"]>("current");
  const [versionTag, setVersionTag] = useState<string | undefined>(undefined);

  const { data: manifest, isLoading, isError, domain } = useDomain(domainSlug);
  const meta = useDomainMetadata(domain);
  const sectorsQuery = useSectors();
  const versionTags = domain ? deprecatedVersionTags(domain) : [];
  const effectiveVersionTag = status === "deprecated" ? versionTag ?? versionTags[0] : undefined;
  const termsQuery = useDomainTermsForStatus(domain, status, effectiveVersionTag);

  const filtered = useMemo(() => {
    const list = termsQuery.data ?? [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (term) =>
        term.label.toLowerCase().includes(q) ||
        term.localName.toLowerCase().includes(q) ||
        term.description?.toLowerCase().includes(q)
    );
  }, [termsQuery.data, query]);

  if (isLoading) return <LoadingBlock />;
  if (isError) return <ErrorBlock title={t("manifestLoadFailed", { ns: "errors" })} />;
  if (!manifest || !domain) {
    return <ErrorBlock title={t("domainNotFound", { ns: "errors", slug: domainSlug })} />;
  }

  const sector = domain.sectorCode ? sectorByCode(sectorsQuery.data ?? [], domain.sectorCode) : undefined;
  const sectorLabel = sector ? t(`sector.${sector.codeValue}`, { ns: "sectors" }) : "";
  const availableStatuses = (["current", "staging", "deprecated"] as const).filter((s) =>
    domain.artifacts.some((a) => a.status === s)
  );

  const artifactsForStatus = domain.artifacts.filter(
    (a) => a.status === status && (status !== "deprecated" || versionTagOf(a) === effectiveVersionTag)
  );
  const artifactsToShow = artifactsForStatus.length > 0 ? artifactsForStatus : domain.artifacts;

  return (
    <div>
      <Helmet>
        <title>{`${domain.label} — ${t("app.title")}`}</title>
      </Helmet>
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          ...(sector ? [{ label: sectorLabel, to: `/sector/${sector.codeValue.toLowerCase()}` }] : []),
          { label: domain.label },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            {meta.data?.title ?? domain.label}
          </h1>
          <p className="term-id mt-1 text-xs text-ink-400">/{domain.slug}</p>
          {(meta.data?.description ?? domain.description) && (
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-500">
              {meta.data?.description ?? domain.description}
            </p>
          )}
          {meta.data?.version && (
            <p className="mt-2 text-xs text-ink-400">
              v{meta.data.version}
              {meta.data.lastModified && <> · updated {meta.data.lastModified}</>}
            </p>
          )}
        </div>

        {availableStatuses.length > 1 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded border border-ink-100 bg-white p-1 text-xs">
              {availableStatuses.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatus(s);
                    if (s !== "deprecated") setVersionTag(undefined);
                  }}
                  className={`rounded-sm px-2.5 py-1 font-medium ${
                    status === s ? "bg-ink-900 text-ink-50" : "text-ink-500 hover:bg-ink-50"
                  }`}
                >
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>
            {status === "deprecated" && versionTags.length > 1 && (
              <select
                value={effectiveVersionTag}
                onChange={(e) => setVersionTag(e.target.value)}
                aria-label="Version"
                className="rounded border border-ink-100 bg-white px-2 py-1.5 text-xs text-ink-700"
              >
                {versionTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">
          {t("domain.artifacts")}
        </h2>
        <ArtifactList artifacts={artifactsToShow} />
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-400">
            {t("domain.terms")}
            {termsQuery.data && (
              <span className="ml-2 text-ink-300">
                {t("domain.termCount", { count: termsQuery.data.length })}
              </span>
            )}
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder") ?? ""}
            aria-label={t("search.placeholder") ?? ""}
            className="w-64 max-w-full rounded border border-ink-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal"
          />
        </div>

        {termsQuery.isLoading && <LoadingBlock />}
        {termsQuery.isError && <ErrorBlock title={t("domainLoadFailed", { ns: "errors" })} />}
        {termsQuery.data && filtered.length === 0 && (
          <p className="text-sm text-ink-400">{t("search.empty", { query })}</p>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.map((term) => (
            <TermRow key={term.id} term={term} />
          ))}
        </div>
      </section>
    </div>
  );
}

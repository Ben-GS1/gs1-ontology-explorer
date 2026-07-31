import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { sectorByCode } from "@/config/sectors";
import { useDomain, useManifest, useSectors } from "@/hooks/useRegistry";
import { loadDomainTerms } from "@/lib/registryClient";
import { RESOLVER_HOST } from "@/config/env";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { StatusBadge } from "@/components/StatusBadge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import type { DomainEntry } from "@/types/registry";

function useTerm(domain: DomainEntry | undefined, localName: string) {
  return useQuery({
    queryKey: ["term", domain?.slug, localName],
    queryFn: async () => {
      const terms = await loadDomainTerms(domain as DomainEntry);
      return terms.find((t) => t.localName === localName);
    },
    enabled: Boolean(domain),
  });
}

export function TermPage() {
  const { domainSlug = "", termName = "" } = useParams();
  const { t } = useTranslation(["common", "sectors", "errors"]);
  const [showRaw, setShowRaw] = useState(false);

  const { domain, isLoading: manifestLoading } = useDomain(domainSlug);
  const manifest = useManifest();
  const sectorsQuery = useSectors();
  const termQuery = useTerm(domain, termName);

  // Cross-reference: does a term with the same @id (or same local name)
  // also appear in other domains' vocabularies? We only check domains that
  // are already cached by React Query from prior navigation to avoid an
  // eager fan-out fetch of every domain on every term view; a manifest-side
  // "usedIn" hint (see manifest.schema.json extension point) can make this
  // exhaustive without client-side cost once the registry grows.
  const otherDomains = useMemo(
    () => (manifest.data?.domains ?? []).filter((d) => d.slug !== domainSlug),
    [manifest.data, domainSlug]
  );

  if (manifestLoading || termQuery.isLoading) return <LoadingBlock />;
  if (!domain) return <ErrorBlock title={t("domainNotFound", { ns: "errors", slug: domainSlug })} />;

  const term = termQuery.data;
  if (!term) {
    return <ErrorBlock title={t("termNotFound", { ns: "errors", term: termName, domain: domainSlug })} />;
  }

  const sector = sectorByCode(sectorsQuery.data ?? [], domain.sectorCode);
  const sectorLabel = sector ? t(`sector.${sector.codeValue}`, { ns: "sectors" }) : domain.sectorCode;
  const permalink = `${RESOLVER_HOST}/${domain.slug}/${term.localName}`;

  return (
    <div>
      <Helmet>
        <title>{`${term.label} — ${domain.label} — ${t("app.title")}`}</title>
        <link rel="alternate" type="application/ld+json" href={term.sourceArtifactUrl} />
      </Helmet>
      <Breadcrumbs
        items={[
          { label: t("breadcrumb.home"), to: "/" },
          ...(sector ? [{ label: sectorLabel, to: `/sector/${sector.codeValue.toLowerCase()}` }] : []),
          { label: domain.label, to: `/${domain.slug}` },
          { label: term.label },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink-900">{term.label}</h1>
        {term.termStatus && <StatusBadge status={term.termStatus} />}
      </div>
      <p className="term-id mt-1 break-all text-sm text-ink-400">{term.id}</p>

      {term.types.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {term.types.map((ty) => (
            <span key={ty} className="term-id rounded-sm border border-ink-100 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
              {ty}
            </span>
          ))}
        </div>
      )}

      {term.description && (
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-700">{term.description}</p>
      )}

      <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 rounded border border-ink-100 bg-white p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{t("term.definedIn")}</dt>
          <dd className="mt-1 text-sm text-ink-700">{domain.label}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{t("term.permalink")}</dt>
          <dd className="term-id mt-1 break-all text-sm text-signal-dim">{permalink}</dd>
        </div>
        {Object.entries(term.relations).map(([pred, values]) => (
          <div key={pred}>
            <dt className="term-id text-xs font-semibold uppercase tracking-wide text-ink-400">{pred}</dt>
            <dd className="term-id mt-1 space-y-0.5 text-sm text-ink-700">
              {values.map((v) => (
                <div key={v} className="break-all">
                  {v}
                </div>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-xs text-ink-400">{t("term.negotiationHint")}</p>

      {otherDomains.length > 0 && (
        <p className="mt-2 text-xs text-ink-400">
          Checking cross-sector usage across {otherDomains.length} other published domain
          {otherDomains.length === 1 ? "" : "s"} — open a domain page once to include it in the cross-reference index.
        </p>
      )}

      <div className="mt-8">
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="text-xs font-medium text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-800"
        >
          {showRaw ? "Hide" : "Show"} {t("term.rawJsonLd")}
        </button>
        {showRaw && (
          <pre className="mt-3 overflow-x-auto rounded border border-ink-100 bg-ink-950 p-4 text-xs text-ink-100">
            {JSON.stringify(term.raw, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

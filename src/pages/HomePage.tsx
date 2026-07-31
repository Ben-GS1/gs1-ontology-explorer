import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { useManifest, useSectors } from "@/hooks/useRegistry";
import { SectorCard } from "@/components/SectorCard";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";

export function HomePage() {
  const { t } = useTranslation("common");
  const manifest = useManifest();
  const sectorsQuery = useSectors();
  const sectors = sectorsQuery.data ?? [];

  const domainsBySector = new Map<string, number>();
  manifest.data?.domains.forEach((d) => {
    domainsBySector.set(d.sectorCode, (domainsBySector.get(d.sectorCode) ?? 0) + 1);
  });

  const populated = sectors.filter((s) => (domainsBySector.get(s.codeValue) ?? 0) > 0);
  const empty = sectors.filter((s) => (domainsBySector.get(s.codeValue) ?? 0) === 0);

  return (
    <div>
      <Helmet>
        <title>{t("app.title")}</title>
      </Helmet>

      <section className="mb-10 border-b border-ink-100 pb-8">
        <h1 className="max-w-2xl font-display text-3xl font-semibold text-ink-900">{t("app.title")}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-500">{t("app.tagline")}</p>
      </section>

      {(manifest.isLoading || sectorsQuery.isLoading) && <LoadingBlock />}
      {manifest.isError && <ErrorBlock title={t("manifestLoadFailed", { ns: "errors" })} />}

      {manifest.data && sectorsQuery.data && (
        <>
          <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">
            {t("sector.heading")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {populated.map((sector) => (
              <SectorCard
                key={sector.codeValue}
                sector={sector}
                domains={manifest.data.domains.filter((d) => d.sectorCode === sector.codeValue)}
              />
            ))}
          </div>

          {empty.length > 0 && (
            <details className="mt-8 text-sm text-ink-400">
              <summary className="cursor-pointer select-none">
                {empty.length} {empty.length === 1 ? "sector" : "sectors"} without published domains yet
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 opacity-60 sm:grid-cols-2 lg:grid-cols-3">
                {empty.map((sector) => (
                  <SectorCard key={sector.codeValue} sector={sector} domains={[]} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

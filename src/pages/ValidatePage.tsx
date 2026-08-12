import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import type { Quad } from "n3";
import { useManifest } from "@/hooks/useRegistry";
import {
  detectDomainForData,
  findShaclArtifacts,
  loadShaclArtifactQuads,
  resolveShapesForDomain,
} from "@/lib/shaclAdapter";
import { parseRdfText, validate, type RdfInputFormat, type ValidationReport } from "@/validator-core";
import { DataInput, type LoadedInput } from "@/components/validator/DataInput";
import { ValidationReportView } from "@/components/validator/ValidationReportView";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import type { Artifact, DomainEntry } from "@/types/registry";

type Step = "input" | "shapes" | "report";

export function ValidatePage() {
  const { t } = useTranslation(["common", "errors"]);
  const [searchParams] = useSearchParams();
  const manifest = useManifest();

  const [step, setStep] = useState<Step>("input");
  const [dataQuads, setDataQuads] = useState<Quad[] | null>(null);
  const [dataFormat, setDataFormat] = useState<RdfInputFormat | null>(null);
  const [dataLabel, setDataLabel] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [domainSlug, setDomainSlug] = useState<string | undefined>(searchParams.get("domain") ?? undefined);
  const [status, setStatus] = useState<Artifact["status"]>((searchParams.get("status") as Artifact["status"]) || "current");
  const [versionTag, setVersionTag] = useState<string | undefined>(searchParams.get("v") ?? undefined);
  const [detecting, setDetecting] = useState(false);
  const [detectedRanking, setDetectedRanking] = useState<{ domainSlug: string; overlapCount: number }[]>([]);

  const [shaclFiles, setShaclFiles] = useState<{ artifact: Artifact; quads: Quad[]; selected: boolean }[]>([]);
  const [estimated, setEstimated] = useState(false);
  const [estimatedNote, setEstimatedNote] = useState<string | null>(null);
  const [shapesError, setShapesError] = useState<string | null>(null);

  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);

  const domain: DomainEntry | undefined = useMemo(
    () => manifest.data?.domains.find((d) => d.slug === domainSlug),
    [manifest.data, domainSlug]
  );

  // If arriving from a domain page's "Validate" link (?domain=rail&status=current),
  // skip straight to shape resolution once the manifest and data are both ready.
  const cameFromDomainContext = Boolean(searchParams.get("domain"));

  async function handleDataLoaded(input: LoadedInput) {
    setParseError(null);
    setBusy(true);
    try {
      const { quads, format } = await parseRdfText(input.text, undefined, input.contentType);
      setDataQuads(quads);
      setDataFormat(format);
      setDataLabel(input.label);
      setReport(null);
      setStep("shapes");

      if (!cameFromDomainContext && manifest.data) {
        setDetecting(true);
        try {
          const ranking = await detectDomainForData(quads, manifest.data);
          setDetectedRanking(ranking);
          if (ranking.length > 0) setDomainSlug(ranking[0].domainSlug);
        } finally {
          setDetecting(false);
        }
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Resolve shapes whenever the selected domain/status/version changes and data is loaded.
  useEffect(() => {
    if (!domain || step === "input") return;
    let cancelled = false;
    setShapesError(null);
    setEstimated(false);
    setEstimatedNote(null);
    setShaclFiles([]);

    (async () => {
      const realShacl = findShaclArtifacts(domain, status, versionTag);
      if (realShacl.length > 0) {
        try {
          const loaded = await Promise.all(
            realShacl.map(async (artifact) => ({ artifact, quads: await loadShaclArtifactQuads(artifact), selected: true }))
          );
          if (!cancelled) setShaclFiles(loaded);
        } catch (err) {
          if (!cancelled) setShapesError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      try {
        const resolved = await resolveShapesForDomain(domain, status, versionTag);
        if (cancelled) return;
        setEstimated(true);
        setEstimatedNote(resolved.sourceLabels[0]);
        setShaclFiles([{ artifact: { label: "estimated" } as Artifact, quads: resolved.shapeQuads, selected: true }]);
      } catch (err) {
        if (!cancelled) setShapesError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, status, versionTag, step]);

  async function runValidation() {
    if (!dataQuads) return;
    setValidating(true);
    try {
      const shapeQuads = shaclFiles.filter((f) => f.selected).flatMap((f) => f.quads);
      const result = await validate(shapeQuads, dataQuads);
      setReport(result);
      setStep("report");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div>
      <Helmet>
        <title>{`${t("validator.title")} — ${t("app.title")}`}</title>
      </Helmet>

      <h1 className="font-display text-2xl font-semibold text-ink-900">{t("validator.title")}</h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-500">{t("validator.intro")}</p>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">
          {t("validator.step1")}
        </h2>
        <DataInput onLoaded={handleDataLoaded} busy={busy} />
        {busy && (
          <div className="mt-3">
            <LoadingBlock />
          </div>
        )}
        {parseError && (
          <div className="mt-3">
            <ErrorBlock title={t("validator.parseFailed")} detail={parseError} />
          </div>
        )}
        {dataQuads && (
          <p className="mt-3 text-xs text-ink-400">
            {t("validator.loaded", { label: dataLabel, count: dataQuads.length, format: dataFormat })}
          </p>
        )}
      </section>

      {dataQuads && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">
            {t("validator.step2")}
          </h2>

          {manifest.isLoading && <LoadingBlock />}

          {manifest.data && (
            <div className="rounded border border-ink-100 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-ink-400">{t("validator.domain")}</label>
                <select
                  value={domainSlug ?? ""}
                  onChange={(e) => {
                    setDomainSlug(e.target.value || undefined);
                    setVersionTag(undefined);
                  }}
                  className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700"
                >
                  <option value="">{t("validator.pickDomain")}</option>
                  {manifest.data.domains.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.label}
                      {detectedRanking[0]?.domainSlug === d.slug ? ` (${t("validator.detected")})` : ""}
                    </option>
                  ))}
                </select>

                {domain && (
                  <>
                    <label className="text-xs text-ink-400">{t("validator.version")}</label>
                    <select
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value as Artifact["status"]);
                        setVersionTag(undefined);
                      }}
                      className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700"
                    >
                      <option value="current">{t("status.current")}</option>
                      <option value="staging">{t("status.staging")}</option>
                      {domain.artifacts.some((a) => a.status === "deprecated") && (
                        <option value="deprecated">{t("status.deprecated")}</option>
                      )}
                    </select>
                  </>
                )}

                {detecting && <span className="text-xs text-ink-400">{t("validator.detecting")}</span>}
              </div>

              {!domainSlug && !detecting && detectedRanking.length === 0 && (
                <p className="mt-3 text-xs text-ink-400">{t("validator.noDomainDetected")}</p>
              )}

              {shapesError && (
                <div className="mt-3">
                  <ErrorBlock title={t("validator.shapesFailed")} detail={shapesError} />
                </div>
              )}

              {estimated && (
                <div className="mt-3 rounded border border-signal/40 bg-signal/5 px-3 py-2 text-xs text-signal-dim">
                  ⚠️ {t("validator.estimatedWarning")}
                  {estimatedNote && <> — {estimatedNote}</>}
                </div>
              )}

              {!estimated && shaclFiles.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs text-ink-400">{t("validator.shaclFilesFound", { count: shaclFiles.length })}</p>
                  <ul className="space-y-1">
                    {shaclFiles.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-ink-700">
                        <input
                          type="checkbox"
                          checked={f.selected}
                          onChange={(e) =>
                            setShaclFiles((prev) =>
                              prev.map((x, idx) => (idx === i ? { ...x, selected: e.target.checked } : x))
                            )
                          }
                        />
                        {f.artifact.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {shaclFiles.some((f) => f.selected) && (
                <button
                  onClick={runValidation}
                  disabled={validating}
                  className="mt-4 rounded bg-ink-900 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
                >
                  {validating ? t("validator.validating") : t("validator.runValidation")}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {report && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">
            {t("validator.step3")}
          </h2>
          <ValidationReportView report={report} />
        </section>
      )}
    </div>
  );
}

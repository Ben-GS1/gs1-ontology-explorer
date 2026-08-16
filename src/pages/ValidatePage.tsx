import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import type { Quad } from "n3";
import { useManifest } from "@/hooks/useRegistry";
import {
  buildManifestDocumentLoader,
  detectDomainsForData,
  findShaclArtifacts,
  loadShaclArtifactQuads,
  resolveShapesForDomain,
} from "@/lib/shaclAdapter";
import { parseRdfText, validate, type DomainMatch, type RdfInputFormat, type ValidationReport } from "@/validator-core";
import { DataInput, type LoadedInput } from "@/components/validator/DataInput";
import { ValidationReportView } from "@/components/validator/ValidationReportView";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import type { Artifact, DomainEntry } from "@/types/registry";

/**
 * jsonld.js reports a failed remote @context fetch with a fairly opaque
 * message ("Dereferencing a URL did not result in a valid JSON-LD
 * object..."). Since that's a common real-world failure (an unreachable
 * or not-yet-CORS-enabled context host) and users can't be expected to
 * know that a "parse error" is really a network problem one level down,
 * detect that pattern and explain it directly instead.
 */
function explainParseError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/dereferencing a url/i.test(message) || /loading document failed/i.test(message)) {
    const url = message.match(/URL:\s*"?([^"\s]+)"?/i)?.[1];
    return url
      ? `Could not load the remote @context "${url}". This is usually because that host isn't reachable, or doesn't allow cross-origin requests (CORS) from this site — the validator already retries via its own CORS-relay proxy before giving up, so this means both attempts failed.`
      : `Could not load a remote @context referenced by this document (unreachable host, or no CORS support). Original error: ${message}`;
  }
  return message;
}

interface ShaclFileState {
  artifact: Artifact;
  quads: Quad[];
  selected: boolean;
}

interface DomainState {
  status: Artifact["status"];
  versionTag?: string;
  shaclFiles: ShaclFileState[];
  estimated: boolean;
  estimatedNote?: string;
  loading: boolean;
  error?: string;
  detectedVia?: DomainMatch["via"];
}

export function ValidatePage() {
  const { t } = useTranslation(["common", "errors"]);
  const [searchParams] = useSearchParams();
  const manifest = useManifest();

  const [dataQuads, setDataQuads] = useState<Quad[] | null>(null);
  const [dataFormat, setDataFormat] = useState<RdfInputFormat | null>(null);
  const [dataLabel, setDataLabel] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);

  // Every domain currently included in the validation run, keyed by slug —
  // a document can legitimately mix terms from several domains at once
  // (e.g. GS1 Discovery Service "disco" master-data terms alongside "rail"
  // sensor terms in one EPCIS document), so this is a set, not a single
  // selection. Each domain's shapes are resolved independently and merged
  // into one combined shape graph when validating — see runValidation().
  const [domainStates, setDomainStates] = useState<Record<string, DomainState>>({});

  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);

  // Resolves any @context URL this app already indexes (every manifest
  // artifact's public url) straight to its known-good `source`, and falls
  // back to this app's own CORS-relay proxy for anything else — see
  // buildManifestDocumentLoader()'s doc comment for why that matters.
  const documentLoader = useMemo(
    () => (manifest.data ? buildManifestDocumentLoader(manifest.data) : undefined),
    [manifest.data]
  );

  // If arriving from a domain page's "Validate" link (?domain=rail&status=current),
  // seed exactly that one domain and skip auto-detection entirely.
  const contextDomainSlug = searchParams.get("domain") ?? undefined;

  function domainBySlug(slug: string): DomainEntry | undefined {
    return manifest.data?.domains.find((d) => d.slug === slug);
  }

  async function loadShapesFor(
    domain: DomainEntry,
    status: Artifact["status"],
    versionTag: string | undefined,
    detectedVia?: DomainMatch["via"]
  ) {
    setDomainStates((prev) => ({
      ...prev,
      [domain.slug]: {
        status,
        versionTag,
        shaclFiles: [],
        estimated: false,
        loading: true,
        detectedVia: detectedVia ?? prev[domain.slug]?.detectedVia,
      },
    }));

    try {
      const realShacl = findShaclArtifacts(domain, status, versionTag);
      if (realShacl.length > 0) {
        const loaded = await Promise.all(
          realShacl.map(async (artifact) => ({
            artifact,
            quads: await loadShaclArtifactQuads(artifact, documentLoader),
            selected: true,
          }))
        );
        setDomainStates((prev) => ({
          ...prev,
          [domain.slug]: { ...prev[domain.slug], shaclFiles: loaded, estimated: false, loading: false },
        }));
        return;
      }
      const resolved = await resolveShapesForDomain(domain, status, versionTag, documentLoader);
      setDomainStates((prev) => ({
        ...prev,
        [domain.slug]: {
          ...prev[domain.slug],
          shaclFiles: [{ artifact: { label: "estimated" } as Artifact, quads: resolved.shapeQuads, selected: true }],
          estimated: true,
          estimatedNote: resolved.sourceLabels[0],
          loading: false,
        },
      }));
    } catch (err) {
      setDomainStates((prev) => ({
        ...prev,
        [domain.slug]: { ...prev[domain.slug], loading: false, error: explainParseError(err) },
      }));
    }
  }

  async function handleDataLoaded(input: LoadedInput) {
    setParseError(null);
    setBusy(true);
    setDomainStates({});
    setReport(null);
    try {
      const { quads, format } = await parseRdfText(input.text, undefined, input.contentType, documentLoader);
      setDataQuads(quads);
      setDataFormat(format);
      setDataLabel(input.label);

      if (contextDomainSlug) {
        const domain = domainBySlug(contextDomainSlug);
        if (domain) {
          const status = (searchParams.get("status") as Artifact["status"]) || "current";
          const versionTag = searchParams.get("v") ?? undefined;
          void loadShapesFor(domain, status, versionTag);
        }
      } else if (manifest.data) {
        let rawDoc: unknown;
        if (format === "jsonld") {
          try {
            rawDoc = JSON.parse(input.text);
          } catch {
            rawDoc = undefined;
          }
        }
        setDetecting(true);
        try {
          const matches = await detectDomainsForData(rawDoc, quads, manifest.data);
          for (const match of matches) {
            const domain = domainBySlug(match.domainSlug);
            if (domain) void loadShapesFor(domain, "current", undefined, match.via);
          }
        } finally {
          setDetecting(false);
        }
      }
    } catch (err) {
      setParseError(explainParseError(err));
    } finally {
      setBusy(false);
    }
  }

  function addDomain(slug: string) {
    const domain = domainBySlug(slug);
    if (domain) void loadShapesFor(domain, "current", undefined);
  }

  function removeDomain(slug: string) {
    setDomainStates((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  }

  function toggleShaclFile(slug: string, index: number, checked: boolean) {
    setDomainStates((prev) => ({
      ...prev,
      [slug]: {
        ...prev[slug],
        shaclFiles: prev[slug].shaclFiles.map((f, i) => (i === index ? { ...f, selected: checked } : f)),
      },
    }));
  }

  async function runValidation() {
    if (!dataQuads) return;
    setValidating(true);
    try {
      const shapeQuads = Object.values(domainStates)
        .flatMap((s) => s.shaclFiles)
        .filter((f) => f.selected)
        .flatMap((f) => f.quads);
      const result = await validate(shapeQuads, dataQuads);
      setReport(result);
    } finally {
      setValidating(false);
    }
  }

  const selectedSlugs = Object.keys(domainStates);
  const addableDomains = (manifest.data?.domains ?? []).filter((d) => !selectedSlugs.includes(d.slug));
  const anySelected = Object.values(domainStates).some((s) => s.shaclFiles.some((f) => f.selected));
  const anyLoading = Object.values(domainStates).some((s) => s.loading);

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
          {detecting && <p className="mb-3 text-xs text-ink-400">{t("validator.detecting")}</p>}

          {manifest.data && (
            <div className="space-y-4">
              {selectedSlugs.length === 0 && !detecting && (
                <p className="text-xs text-ink-400">{t("validator.noDomainDetected")}</p>
              )}

              {selectedSlugs.map((slug) => {
                const domain = domainBySlug(slug);
                const s = domainStates[slug];
                if (!domain || !s) return null;
                const availableVersionTags = Array.from(
                  new Set(
                    domain.artifacts
                      .filter((a) => a.status === "deprecated")
                      .map((a) => a.url.match(/\/versions\/([^/]+)\//)?.[1])
                      .filter((tag): tag is string => Boolean(tag))
                  )
                );

                return (
                  <div key={slug} className="rounded border border-ink-100 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-medium text-ink-900">{domain.label}</span>
                        {s.detectedVia && (
                          <span className="rounded-sm bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
                            {s.detectedVia === "context"
                              ? t("validator.detectedViaContext")
                              : t("validator.detectedViaTerms")}
                          </span>
                        )}
                      </div>
                      <button onClick={() => removeDomain(slug)} className="text-xs text-ink-400 hover:text-ledger-rust">
                        {t("validator.removeDomain")}
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={s.status}
                        onChange={(e) =>
                          void loadShapesFor(domain, e.target.value as Artifact["status"], undefined, s.detectedVia)
                        }
                        className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700"
                      >
                        <option value="current">{t("status.current")}</option>
                        <option value="staging">{t("status.staging")}</option>
                        {domain.artifacts.some((a) => a.status === "deprecated") && (
                          <option value="deprecated">{t("status.deprecated")}</option>
                        )}
                      </select>
                      {s.status === "deprecated" && availableVersionTags.length > 1 && (
                        <select
                          value={s.versionTag ?? availableVersionTags[0]}
                          onChange={(e) => void loadShapesFor(domain, "deprecated", e.target.value, s.detectedVia)}
                          className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700"
                        >
                          {availableVersionTags.map((tag) => (
                            <option key={tag} value={tag}>
                              {tag}
                            </option>
                          ))}
                        </select>
                      )}
                      {s.loading && <span className="text-xs text-ink-400">{t("validator.detecting")}</span>}
                    </div>

                    {s.error && (
                      <div className="mt-3">
                        <ErrorBlock title={t("validator.shapesFailed")} detail={s.error} />
                      </div>
                    )}

                    {s.estimated && (
                      <div className="mt-3 rounded border border-signal/40 bg-signal/5 px-3 py-2 text-xs text-signal-dim">
                        ⚠️ {t("validator.estimatedWarning")}
                        {s.estimatedNote && <> — {s.estimatedNote}</>}
                      </div>
                    )}

                    {!s.estimated && s.shaclFiles.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1.5 text-xs text-ink-400">
                          {t("validator.shaclFilesFound", { count: s.shaclFiles.length })}
                        </p>
                        <ul className="space-y-1">
                          {s.shaclFiles.map((f, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm text-ink-700">
                              <input
                                type="checkbox"
                                checked={f.selected}
                                onChange={(e) => toggleShaclFile(slug, i, e.target.checked)}
                              />
                              {f.artifact.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}

              {addableDomains.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-ink-400">{t("validator.addDomain")}</label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addDomain(e.target.value);
                    }}
                    className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700"
                  >
                    <option value="">{t("validator.pickDomain")}</option>
                    {addableDomains.map((d) => (
                      <option key={d.slug} value={d.slug}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {anySelected && (
                <button
                  onClick={runValidation}
                  disabled={validating || anyLoading}
                  className="rounded bg-ink-900 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
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

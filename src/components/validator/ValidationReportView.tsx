import { useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { ValidationReport, ValidationResultItem } from "@/validator-core";

function localName(iri: string | undefined): string {
  if (!iri) return "—";
  const cut = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  return cut >= 0 ? iri.slice(cut + 1) : iri;
}

function severityTone(severity: ValidationResultItem["severity"]): string {
  if (severity === "Violation") return "text-ledger-rust";
  if (severity === "Warning") return "text-signal-dim";
  return "text-ink-400";
}

function ResultRow({ result }: { result: ValidationResultItem }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-ink-50 last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-50"
      >
        <span className={clsx("status-dot mt-1.5 shrink-0", severityTone(result.severity), "bg-current")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink-800">{result.message || t("validator.noMessage")}</span>
          <span className="term-id mt-0.5 block truncate text-xs text-ink-400">
            {localName(result.path)} · {t("validator.onNode")} {localName(result.focusNode)}
          </span>
        </span>
        <span className={clsx("term-id shrink-0 text-[11px] font-medium uppercase", severityTone(result.severity))}>
          {result.severity}
        </span>
      </button>
      {open && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-ink-50 bg-ink-50 px-4 py-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-ink-400">{t("validator.focusNode")}</dt>
            <dd className="term-id break-all text-ink-700">{result.focusNode || "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{t("validator.path")}</dt>
            <dd className="term-id break-all text-ink-700">{result.path || "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{t("validator.sourceShape")}</dt>
            <dd className="term-id break-all text-ink-700">{result.sourceShape || "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{t("validator.constraint")}</dt>
            <dd className="term-id break-all text-ink-700">{localName(result.sourceConstraintComponent)}</dd>
          </div>
          {result.value && (
            <div className="sm:col-span-2">
              <dt className="text-ink-400">{t("validator.offendingValue")}</dt>
              <dd className="term-id break-all text-ink-700">{result.value}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

export function ValidationReportView({ report }: { report: ValidationReport }) {
  const { t } = useTranslation("common");

  return (
    <div className="rounded border border-ink-100 bg-white">
      <div
        className={clsx(
          "flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3",
          report.conforms ? "bg-ledger-teal/5" : "bg-ledger-rust/5"
        )}
      >
        <p className={clsx("font-display text-sm font-semibold", report.conforms ? "text-ledger-teal" : "text-ledger-rust")}>
          {report.conforms ? t("validator.conforms") : t("validator.doesNotConform")}
        </p>
        <div className="flex gap-4 text-xs text-ink-500">
          <span className="text-ledger-rust">
            {report.counts.violations} {t("validator.violations")}
          </span>
          <span className="text-signal-dim">
            {report.counts.warnings} {t("validator.warnings")}
          </span>
          <span className="text-ink-400">
            {report.counts.infos} {t("validator.infos")}
          </span>
        </div>
      </div>

      {report.results.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-400">{t("validator.noResults")}</p>
      ) : (
        <ul>
          {report.results.map((r, i) => (
            <ResultRow key={i} result={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

import type { Quad } from "n3";
// @rdfjs/dataset ships no TypeScript types; ambient declaration below.
import rdfDataset from "@rdfjs/dataset";
import type { Severity, ValidationReport, ValidationResultItem } from "./types";

// rdf-validate-shacl has official types but they require a real rdfjs
// DatasetCore (not a bare array) for both the constructor and .validate().
// This is the minimal shape of what this module actually calls.
interface ShaclValidatorLike {
  validate: (dataset: unknown) => Promise<{
    conforms: boolean;
    results: Array<{
      message: Array<{ value: string }>;
      severity?: { value: string };
      focusNode?: { value: string };
      path?: { value: string };
      sourceShape?: { value: string };
      sourceConstraintComponent?: { value: string };
      value?: { value: string };
    }>;
  }>;
}

function severityFromIri(iri: string | undefined): Severity {
  if (!iri) return "Violation";
  if (iri.endsWith("Warning")) return "Warning";
  if (iri.endsWith("Info")) return "Info";
  return "Violation";
}

/**
 * Runs SHACL validation of `dataQuads` against `shapeQuads` and returns a
 * plain, JSON-serializable report — no rdfjs terms leak out, so the UI
 * layer (and anything that wants to persist/transmit a report) doesn't
 * need to know anything about the RDF/JS data model.
 */
export async function validate(shapeQuads: Quad[], dataQuads: Quad[]): Promise<ValidationReport> {
  // Dynamic import: this pulls in the whole SHACL engine + its
  // dependency tree, which is worth keeping out of the main app bundle
  // until someone actually opens the validator — see the lazy route in
  // src/App.tsx.
  const { default: SHACLValidator } = await import("rdf-validate-shacl");
  const shapesDataset = rdfDataset.dataset(shapeQuads);
  const validator = new SHACLValidator(shapesDataset, {}) as unknown as ShaclValidatorLike;
  const dataset = rdfDataset.dataset(dataQuads);
  const report = await validator.validate(dataset);

  const results: ValidationResultItem[] = report.results.map((r) => ({
    message: r.message.map((m) => m.value).join(" "),
    severity: severityFromIri(r.severity?.value),
    focusNode: r.focusNode?.value ?? "",
    path: r.path?.value,
    sourceShape: r.sourceShape?.value,
    sourceConstraintComponent: r.sourceConstraintComponent?.value,
    value: r.value?.value,
  }));

  const counts = { violations: 0, warnings: 0, infos: 0 };
  for (const r of results) {
    if (r.severity === "Violation") counts.violations++;
    else if (r.severity === "Warning") counts.warnings++;
    else counts.infos++;
  }

  return { conforms: report.conforms, results, counts };
}

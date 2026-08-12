/**
 * src/validator-core — a self-contained SHACL validation engine.
 *
 * IMPORTANT: nothing in this folder imports from anywhere else in the
 * gs1-ontology-explorer app (no "@/config", "@/lib/registryClient", no
 * React). It only depends on published npm packages (n3, jsonld,
 * rdf-validate-shacl). That's deliberate: this folder is designed to be
 * copied verbatim into a different project and keep working — see
 * README.md in this folder for the extraction recipe. The app-specific
 * glue (resolving which shapes to use from the GS1 manifest, React UI)
 * lives outside this folder, in src/lib/shaclAdapter.ts and
 * src/components/validator/.
 */
import type { Quad } from "n3";

export type RdfInputFormat = "jsonld" | "turtle";

export interface ParsedGraph {
  quads: Quad[];
  format: RdfInputFormat;
}

export type Severity = "Violation" | "Warning" | "Info";

export interface ValidationResultItem {
  message: string;
  severity: Severity;
  focusNode: string;
  path?: string;
  sourceShape?: string;
  sourceConstraintComponent?: string;
  value?: string;
}

export interface ValidationReport {
  conforms: boolean;
  results: ValidationResultItem[];
  counts: { violations: number; warnings: number; infos: number };
}

export interface ShapeSource {
  /** Human label for where this shape graph came from, e.g. a filename or "estimated from ontology". */
  label: string;
  quads: Quad[];
}

import type { Quad, Term } from "n3";
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

const SH = "http://www.w3.org/ns/shacl#";
const SH_SPARQL = SH + "sparql";

/**
 * rdf-validate-shacl (the engine this module wraps) documents that it does
 * not support SHACL-SPARQL constraints (sh:sparql) at all — evaluating an
 * arbitrary SPARQL SELECT against the data graph needs a real SPARQL
 * engine, which is out of scope here. Left as-is, a shapes graph
 * containing even one sh:sparql constraint makes the *entire* validate()
 * call throw ("Cannot find validator for constraint component
 * ...SPARQLConstraintComponent"), aborting every other shape's results
 * too — a single advanced shape silently takes down the whole run, which
 * from a user's perspective just looks like "the validator doesn't work".
 *
 * This strips every sh:sparql constraint (and, if the shape node that
 * carried it has no *other* constraints left afterwards, drops the shape
 * from having a target at all — an empty NodeShape with a target isn't
 * meaningful either way) before handing the graph to the engine, and
 * returns a human-readable warning per shape so the caller can tell the
 * user "this part of your shapes file was not checked" rather than
 * silently validating less than it looks like.
 */
function stripUnsupportedConstraints(shapeQuads: Quad[]): { quads: Quad[]; warnings: string[] } {
  const sparqlTriples = shapeQuads.filter((q) => q.predicate.value === SH_SPARQL);
  if (sparqlTriples.length === 0) return { quads: shapeQuads, warnings: [] };

  const toRemove = new Set<Quad>();
  const warnings: string[] = [];

  for (const triple of sparqlTriples) {
    toRemove.add(triple);
    // The sh:sparql object is usually a blank node holding the constraint's
    // own sh:select/sh:message/sh:prefixes triples — walk and remove that
    // whole (blank-node-rooted) structure too, not just the link to it.
    const visited = new Set<string>();
    const stack: Term[] = [triple.object];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.termType !== "BlankNode" || visited.has(node.value)) continue;
      visited.add(node.value);
      for (const q of shapeQuads) {
        if (q.subject.equals(node)) {
          toRemove.add(q);
          stack.push(q.object);
        }
      }
    }
    warnings.push(
      `Shape "${triple.subject.value}" uses a SHACL-SPARQL constraint (sh:sparql), which this validator ` +
        `does not support (SPARQL-based constraints need a full SPARQL engine). This part of the shape was skipped.`
    );
  }

  const quads = shapeQuads.filter((q) => !toRemove.has(q));
  return { quads, warnings };
}

/**
 * Runs SHACL validation of `dataQuads` against `shapeQuads` and returns a
 * plain, JSON-serializable report — no rdfjs terms leak out, so the UI
 * layer (and anything that wants to persist/transmit a report) doesn't
 * need to know anything about the RDF/JS data model.
 */
export async function validate(shapeQuads: Quad[], dataQuads: Quad[]): Promise<ValidationReport> {
  const { quads: usableShapeQuads, warnings: engineWarnings } = stripUnsupportedConstraints(shapeQuads);

  // Dynamic import: this pulls in the whole SHACL engine + its
  // dependency tree, which is worth keeping out of the main app bundle
  // until someone actually opens the validator — see the lazy route in
  // src/App.tsx.
  const { default: SHACLValidator } = await import("rdf-validate-shacl");
  const shapesDataset = rdfDataset.dataset(usableShapeQuads);
  const validator = new SHACLValidator(shapesDataset, {}) as unknown as ShaclValidatorLike;
  const dataset = rdfDataset.dataset(dataQuads);

  let report: Awaited<ReturnType<ShaclValidatorLike["validate"]>>;
  try {
    report = await validator.validate(dataset);
  } catch (err) {
    // Defense in depth: stripUnsupportedConstraints() handles the one
    // documented gap (sh:sparql), but surface any other "engine doesn't
    // support this constraint type" failure the same explicit way rather
    // than letting a raw exception propagate with no usable explanation.
    const message = err instanceof Error ? err.message : String(err);
    if (/Cannot find validator for constraint component/i.test(message)) {
      throw new Error(
        `This shapes graph uses a SHACL constraint type the validation engine doesn't support (${message}). ` +
          `Try removing or simplifying that constraint.`
      );
    }
    throw err;
  }

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

  return { conforms: report.conforms, results, counts, engineWarnings };
}

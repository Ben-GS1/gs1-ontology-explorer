/**
 * A JSON-LD document's own @context controls how its property VALUES are
 * interpreted — critically, whether a plain string like "epcis:EPCISEvent"
 * used as the value of e.g. sh:targetClass expands to an IRI reference or
 * stays a plain string literal. That's controlled per-property by the
 * context marking it "@type": "@id" (or "@vocab"); a context that only
 * defines the "sh" prefix itself (mapping it to the SHACL namespace, so
 * property *keys* like "sh:targetClass" resolve to the right predicate)
 * does NOT automatically also mark that predicate's *values* as @id-typed
 * — those are two independent context features. Real SHACL vocabulary
 * terms (sh:targetClass, sh:path, sh:class, sh:datatype, ...) are always,
 * unambiguously IRI-valued, but a hand-written or naive SHACL-as-JSON-LD
 * document can easily omit the @id-typing half of that and still look
 * superficially correct — every predicate resolves fine, it's only the
 * *values* that silently stay uninterpreted strings instead of IRIs.
 *
 * The practical effect of that omission is severe and silent: every
 * sh:targetClass/sh:targetNode/sh:targetSubjectsOf/sh:targetObjectsOf
 * stops matching anything at all (nothing in the data graph has rdf:type
 * "the literal string \"epcis:EPCISEvent\""), and every sh:path stops
 * resolving to any actual triples. The validator doesn't error — it just
 * has nothing to check, and SHACL's "conforms" is vacuously true when a
 * shape has no target nodes. A shapes graph broken this way reports
 * conforms: true, 0 issues regardless of what the data actually
 * contains, which looks exactly like "the data is fine" instead of "the
 * validator never actually ran anything".
 *
 * Since SHACL is a fixed, well-known vocabulary — not something every
 * third-party file should have to redeclare @id-typing for correctly on
 * its own — this context supplies that typing ourselves, unconditionally,
 * for every SHACL Core (and the handful of common SHACL-SPARQL) property
 * whose value is always an IRI or a list of IRIs. It's applied via
 * jsonld.js's `expandContext` option when parsing a *shapes* document
 * specifically (see parseShaclShapesJsonLd() in rdf.ts) — never for
 * ordinary data documents, which have no reason to expect SHACL-specific
 * typing on unrelated properties that might happen to share a name.
 *
 * `expandContext` is processed as the *initial* active context, before
 * the document's own @context entries are applied on top of it — so a
 * document that DOES correctly declare its own @id-typing for these
 * terms (most real, tool-generated SHACL JSON-LD does) simply overrides
 * this with the same effective result; this only changes behavior for
 * documents that were missing it.
 *
 * sh:in and sh:hasValue are deliberately NOT typed here: unlike the
 * properties below, their values are legitimately sometimes IRIs and
 * sometimes literals depending on what's being constrained (an
 * enumeration of literal codes vs. an enumeration of allowed IRIs), so
 * forcing @id-typing would be wrong as often as right. A document using
 * either against an IRI-valued property needs to say so itself, e.g.
 * with an explicit {"@id": "..."} value.
 */
const SH = "http://www.w3.org/ns/shacl#";

function idTyped(localName: string): { "@id": string; "@type": "@id" } {
  return { "@id": SH + localName, "@type": "@id" };
}

export const SHACL_JSONLD_CONTEXT: Record<string, unknown> = {
  sh: SH,

  // Targeting
  "sh:targetClass": idTyped("targetClass"),
  "sh:targetNode": idTyped("targetNode"),
  "sh:targetSubjectsOf": idTyped("targetSubjectsOf"),
  "sh:targetObjectsOf": idTyped("targetObjectsOf"),

  // Property paths and node/value typing
  "sh:path": idTyped("path"),
  "sh:class": idTyped("class"),
  "sh:node": idTyped("node"),
  "sh:datatype": idTyped("datatype"),
  "sh:severity": idTyped("severity"),

  // Pairwise property-comparison constraints (all take a property IRI)
  "sh:equals": idTyped("equals"),
  "sh:disjoint": idTyped("disjoint"),
  "sh:lessThan": idTyped("lessThan"),
  "sh:lessThanOrEquals": idTyped("lessThanOrEquals"),

  // Shape-valued constraints that reference another shape by IRI (as
  // opposed to an inline blank-node shape, which is already a JSON object
  // and unaffected by @type: @id either way)
  "sh:qualifiedValueShape": idTyped("qualifiedValueShape"),

  // rdf:List of property IRIs
  "sh:ignoredProperties": { "@id": SH + "ignoredProperties", "@type": "@id", "@container": "@list" },
};

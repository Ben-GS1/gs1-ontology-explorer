import type { Quad } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * Pulls every string URL referenced in a JSON-LD document's top-level
 * @context, whatever shape it's in — a single string, an array mixing
 * strings and inline prefix objects, etc. Inline prefix objects are
 * intentionally not descended into here (their *values* are namespace
 * IRIs, not documents to fetch) — this is specifically about the
 * document-reference form of @context, which is what a domain's own
 * context artifact URL (e.g. ".../rail/rail-context.jsonld") looks like
 * when referenced from instance data.
 */
export function extractContextUrls(rawDoc: unknown): string[] {
  if (!rawDoc || typeof rawDoc !== "object") return [];
  const ctx = (rawDoc as Record<string, unknown>)["@context"];
  const entries = Array.isArray(ctx) ? ctx : ctx !== undefined ? [ctx] : [];
  return entries.filter((e): e is string => typeof e === "string");
}

/** Every predicate IRI used, plus every object IRI of an rdf:type triple — the two places a vocabulary's terms show up in instance data. */
export function extractUsedTermIris(dataQuads: Quad[]): Set<string> {
  const iris = new Set<string>();
  for (const q of dataQuads) {
    if (q.predicate.termType === "NamedNode") iris.add(q.predicate.value);
    if (q.predicate.value === RDF_TYPE && q.object.termType === "NamedNode") iris.add(q.object.value);
  }
  return iris;
}

export interface DomainCandidate {
  domainSlug: string;
  /** Every term IRI this domain's own vocabulary defines (from VocabTerm.id). */
  knownTermIris: Set<string>;
}

export type DetectionSource = "context" | "terms";

export interface DomainMatch {
  domainSlug: string;
  /** Number of IRIs used in the data that this domain also defines (0 for a pure @context-URL match). */
  overlapCount: number;
  via: DetectionSource;
}

/**
 * Ranks known domains by how many of the data's used term IRIs they
 * define, descending. A simple but effective heuristic: real instance
 * data overwhelmingly uses predicates/types from the vocabulary it's
 * meant to conform to, so the domain with the most matches is almost
 * always the right one — ties or zero matches are surfaced as "unknown"
 * by the caller (src/lib/shaclAdapter.ts) rather than guessed at.
 *
 * This is the *secondary* signal — prefer extractContextUrls() (matched
 * against the manifest's own artifact URLs in shaclAdapter.ts) where
 * available, since a document explicitly declaring which context(s) it
 * uses is far more reliable than inferring it from term overlap alone,
 * and — critically — a document can legitimately reference more than one
 * domain's terms at once (e.g. GS1 Discovery Service "disco" master-data
 * terms alongside "rail" sensor terms in the same EPCIS document). Both
 * signals are combined, not treated as alternatives — see
 * shaclAdapter.ts::detectDomainsForData().
 */
export function detectLikelyDomains(dataQuads: Quad[], candidates: DomainCandidate[]): DomainMatch[] {
  const used = extractUsedTermIris(dataQuads);
  const matches = candidates
    .map((c) => ({
      domainSlug: c.domainSlug,
      overlapCount: Array.from(used).filter((iri) => c.knownTermIris.has(iri)).length,
      via: "terms" as const,
    }))
    .filter((m) => m.overlapCount > 0);
  return matches.sort((a, b) => b.overlapCount - a.overlapCount);
}

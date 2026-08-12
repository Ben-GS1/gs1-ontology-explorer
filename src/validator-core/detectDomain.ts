import type { Quad } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

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

export interface DomainMatch {
  domainSlug: string;
  /** Number of IRIs used in the data that this domain also defines. */
  overlapCount: number;
}

/**
 * Ranks known domains by how many of the data's used term IRIs they
 * define, descending. A simple but effective heuristic: real instance
 * data overwhelmingly uses predicates/types from the vocabulary it's
 * meant to conform to, so the domain with the most matches is almost
 * always the right one — ties or zero matches are surfaced as "unknown"
 * by the caller (src/lib/shaclAdapter.ts) rather than guessed at.
 */
export function detectLikelyDomains(dataQuads: Quad[], candidates: DomainCandidate[]): DomainMatch[] {
  const used = extractUsedTermIris(dataQuads);
  const matches = candidates
    .map((c) => ({
      domainSlug: c.domainSlug,
      overlapCount: Array.from(used).filter((iri) => c.knownTermIris.has(iri)).length,
    }))
    .filter((m) => m.overlapCount > 0);
  return matches.sort((a, b) => b.overlapCount - a.overlapCount);
}

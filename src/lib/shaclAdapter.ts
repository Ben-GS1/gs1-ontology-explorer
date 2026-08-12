import {
  detectLikelyDomains,
  inferShapesFromOntology,
  parseRdfText,
  type DomainCandidate,
  type OntologyTermLike,
} from "@/validator-core";
import type { Quad } from "n3";
import { loadDomainTerms, versionTagOf } from "./registryClient";
import type { Artifact, DomainEntry, RegistryManifest, VocabTerm } from "@/types/registry";

export interface ResolvedShapes {
  shapeQuads: Quad[];
  /** True if no real SHACL file was found and these were heuristically derived from the ontology instead. */
  estimated: boolean;
  /** Human labels of the artifact(s) actually used — SHACL filenames, or a note that shapes were inferred. */
  sourceLabels: string[];
}

function toOntologyTermLike(term: VocabTerm): OntologyTermLike {
  return { id: term.id, label: term.label, types: term.types, relations: term.relations };
}

/**
 * Fetches a URL with an Accept header that prefers RDF representations —
 * this is what makes "paste a resolver URL like
 * https://gs1-epcis-reg.org/rail/geo" work: a content-negotiating
 * endpoint (see api/src/functions/resolve.js) returns the JSON-LD/Turtle
 * representation instead of the HTML page for this request, the same way
 * curl -H "Accept: application/ld+json" does. Plain file URLs (e.g. a
 * raw GitHub Pages .jsonld link) simply ignore the header and return
 * their one representation, which also works fine here.
 */
export async function fetchRdfWithContentNegotiation(
  url: string
): Promise<{ text: string; contentType: string | null }> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/ld+json, text/turtle;q=0.9, application/rdf+xml;q=0.8, application/json;q=0.5",
    },
  });
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with ${res.status}`);
  }
  return { text: await res.text(), contentType: res.headers.get("content-type") };
}

/** Fetches and parses one SHACL artifact into quads — the primitive the per-file selection UI in ValidatePage builds on. */
export async function loadShaclArtifactQuads(artifact: Artifact): Promise<Quad[]> {
  const { text, contentType } = await fetchRdfWithContentNegotiation(artifact.source);
  const format = artifact.mediaType === "text/turtle" ? "turtle" : "jsonld";
  const { quads } = await parseRdfText(text, format, contentType ?? undefined);
  return quads;
}

/** Finds the SHACL artifacts published for a domain at a given (status, versionTag) — every matching file, not just one. */
export function findShaclArtifacts(domain: DomainEntry, status: Artifact["status"], versionTag?: string): Artifact[] {
  return domain.artifacts.filter(
    (a) => a.kind === "shacl" && a.status === status && (status !== "deprecated" || versionTagOf(a) === versionTag)
  );
}

/**
 * Resolves the shapes to validate against for one domain/version:
 * every published SHACL file for that (status, versionTag) if any exist
 * (merged into one shapes graph — "intelligent" here means "use
 * everything the domain actually publishes", not guessing which one
 * file is the right one), otherwise a best-effort shapes graph inferred
 * from that domain's own ontology/vocabulary — always flagged as
 * estimated so the UI can warn accordingly.
 */
export async function resolveShapesForDomain(
  domain: DomainEntry,
  status: Artifact["status"],
  versionTag?: string
): Promise<ResolvedShapes> {
  const shaclArtifacts = findShaclArtifacts(domain, status, versionTag);

  if (shaclArtifacts.length > 0) {
    const parsed = await Promise.all(shaclArtifacts.map(loadShaclArtifactQuads));
    return {
      shapeQuads: parsed.flat(),
      estimated: false,
      sourceLabels: shaclArtifacts.map((a) => a.label),
    };
  }

  const terms = await loadDomainTerms(domain, status, versionTag);
  const shapeQuads = inferShapesFromOntology(terms.map(toOntologyTermLike));
  return {
    shapeQuads,
    estimated: true,
    sourceLabels: [`Inferred from the ${domain.label} ontology (no SHACL file published for this version)`],
  };
}

/**
 * Loads every published domain's current terms (best-effort — a domain
 * whose vocabulary fails to load is skipped, not fatal) and ranks them by
 * overlap with the given data, for the "detect which domain this data
 * belongs to" step in the standalone/global validator.
 */
export async function detectDomainForData(dataQuads: Quad[], manifest: RegistryManifest) {
  const candidates: DomainCandidate[] = [];
  await Promise.all(
    manifest.domains.map(async (domain) => {
      try {
        const terms = await loadDomainTerms(domain, "current");
        candidates.push({ domainSlug: domain.slug, knownTermIris: new Set(terms.map((t) => t.id)) });
      } catch {
        // domain vocabulary unreachable — simply excluded from detection, not a hard failure
      }
    })
  );
  return detectLikelyDomains(dataQuads, candidates);
}

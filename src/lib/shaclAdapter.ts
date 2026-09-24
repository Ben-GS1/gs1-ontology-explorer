import {
  detectLikelyDomains,
  extractContextUrls,
  inferShapesFromOntology,
  parseRdfText,
  type DomainCandidate,
  type DomainMatch,
  type JsonLdDocumentLoader,
  type OntologyTermLike,
} from "@/validator-core";
import { DataFactory } from "n3";
import type { Quad } from "n3";
import { loadDomainTerms, versionTagOf } from "./registryClient";
import type { Artifact, DomainEntry, RegistryManifest, VocabTerm } from "@/types/registry";

const RDFS_SUBCLASSOF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";

/**
 * SHACL's sh:targetClass matching includes instances of *subclasses* of
 * the named class (per the SHACL spec's class-based target semantics),
 * but only insofar as the class hierarchy is actually present as
 * rdfs:subClassOf triples in the graph being searched — see
 * rdf-validate-shacl's getInstancesOf()/getSubClassesOf(), which look for
 * those triples in the *data* graph specifically. Real-world instance
 * data essentially never states its own class hierarchy (an EPCIS
 * ObjectEvent instance has no reason to also assert
 * "epcis:ObjectEvent rdfs:subClassOf epcis:EPCISEvent" itself), and a
 * domain's SHACL shapes commonly target an abstract superclass precisely
 * so one shape covers every concrete subtype — so without this, a shape
 * targeting e.g. epcis:EPCISEvent silently never matches any
 * epcis:ObjectEvent/epcis:AggregationEvent/... node at all, and
 * validation of that shape is quietly skipped rather than run.
 *
 * This derives rdfs:subClassOf quads from a domain's own already-parsed
 * ontology terms (VocabTerm.relations["rdfs:subClassOf"], populated by
 * vocabParser.ts) — the same data the domain page's own type hierarchy
 * display already uses — so they can be merged into the *data* graph
 * before validation, making that subclass matching actually work for
 * this app's own published domains. Callers should merge the result into
 * dataQuads, not shapeQuads, to match where rdf-validate-shacl looks.
 */
export function buildClassHierarchyQuads(terms: VocabTerm[]): Quad[] {
  const { namedNode, quad } = DataFactory;
  const quads: Quad[] = [];
  for (const term of terms) {
    for (const superClassIri of term.relations["rdfs:subClassOf"] ?? []) {
      quads.push(quad(namedNode(term.id), namedNode(RDFS_SUBCLASSOF), namedNode(superClassIri)));
    }
  }
  return quads;
}

export interface ResolvedShapes {
  shapeQuads: Quad[];
  /** True if no real SHACL file was found and these were heuristically derived from the ontology instead. */
  estimated: boolean;
  /** Human labels of the artifact(s) actually used — SHACL filenames, or a note that shapes were inferred. */
  sourceLabels: string[];
  /** rdfs:subClassOf quads from this domain's own ontology — see buildClassHierarchyQuads(). Merge into dataQuads. */
  classHierarchyQuads: Quad[];
}

function toOntologyTermLike(term: VocabTerm): OntologyTermLike {
  return { id: term.id, label: term.label, types: term.types, relations: term.relations };
}

/**
 * Fetches a URL, falling back to this app's own same-origin proxy
 * (api/src/functions/proxyFetch.js, GET /api/proxy?url=...) if the direct
 * browser fetch fails — which, for a third-party host, is often actually
 * a CORS rejection (no Access-Control-Allow-Origin) rather than the host
 * being unreachable at all: the proxy's server-side fetch is never
 * subject to CORS, and relays the response with that header added. Used
 * for anything the validator needs to dereference that isn't already
 * known to come from a CORS-reliable host (GitHub Pages already sends
 * Access-Control-Allow-Origin: *, so this fallback is rarely even
 * exercised for this app's own manifest-known artifacts — it mainly
 * matters for genuinely external references like a data document's own
 * remote @context).
 */
async function fetchTextWithProxyFallback(
  url: string,
  accept: string
): Promise<{ text: string; contentType: string | null }> {
  try {
    const res = await fetch(url, { headers: { Accept: accept } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), contentType: res.headers.get("content-type") };
  } catch (directError) {
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      return { text: await res.text(), contentType: res.headers.get("content-type") };
    } catch (proxyError) {
      const directMsg = directError instanceof Error ? directError.message : String(directError);
      const proxyMsg = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`Could not load ${url} (direct: ${directMsg}; via proxy: ${proxyMsg})`);
    }
  }
}

/**
 * Builds a jsonld.js document loader that resolves any @context (or other
 * referenced document) URL the manifest already knows about — every
 * artifact's public `url` — directly from its `source` (the actual,
 * always-reachable GitHub Pages location), instead of the public URL
 * itself. This matters because the public resolver host
 * (e.g. gs1-epcis-reg.org) may not have its custom domain live yet, or —
 * once it is — a browser's cross-origin fetch of it still depends on the
 * resolver correctly following redirects through to a CORS-enabled final
 * response; going straight to the known-good `source` sidesteps both
 * failure modes entirely for anything this app already indexes.
 *
 * URLs the manifest doesn't know about (e.g. a genuinely external context
 * like ref.gs1.org's own EPCIS context) fall through to
 * fetchTextWithProxyFallback — a plain fetch first, then this app's own
 * CORS-relay proxy if that fails, rather than jsonld.js's full default
 * loader.
 */
export function buildManifestDocumentLoader(manifest: RegistryManifest): JsonLdDocumentLoader {
  const urlToSource = new Map<string, string>();
  for (const domain of manifest.domains) {
    for (const artifact of domain.artifacts) {
      urlToSource.set(artifact.url, artifact.source);
    }
  }

  return async (url: string) => {
    const fetchUrl = urlToSource.get(url) ?? url;
    const { text } = await fetchTextWithProxyFallback(fetchUrl, "application/ld+json, application/json;q=0.9");
    return { document: JSON.parse(text), documentUrl: url };
  };
}

/**
 * Fetches a URL with an Accept header that prefers RDF representations —
 * this is what makes "paste a resolver URL like
 * https://gs1-epcis-reg.org/rail/geo" work: a content-negotiating
 * endpoint (see api/src/functions/resolve.js) returns the JSON-LD/Turtle
 * representation instead of the HTML page for this request, the same way
 * curl -H "Accept: application/ld+json" does. Plain file URLs (e.g. a
 * raw GitHub Pages .jsonld link) simply ignore the header and return
 * their one representation, which also works fine here. Falls back to
 * this app's own CORS-relay proxy if the direct fetch fails — see
 * fetchTextWithProxyFallback().
 */
export async function fetchRdfWithContentNegotiation(
  url: string
): Promise<{ text: string; contentType: string | null }> {
  return fetchTextWithProxyFallback(
    url,
    "application/ld+json, text/turtle;q=0.9, application/rdf+xml;q=0.8, application/json;q=0.5"
  );
}

/** Fetches and parses one SHACL artifact into quads — the primitive the per-file selection UI in ValidatePage builds on. */
export async function loadShaclArtifactQuads(artifact: Artifact, documentLoader?: JsonLdDocumentLoader): Promise<Quad[]> {
  const { text, contentType } = await fetchRdfWithContentNegotiation(artifact.source);
  const format = artifact.mediaType === "text/turtle" ? "turtle" : "jsonld";
  const { quads } = await parseRdfText(text, format, contentType ?? undefined, documentLoader, "shapes");
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
  versionTag?: string,
  documentLoader?: JsonLdDocumentLoader
): Promise<ResolvedShapes> {
  const shaclArtifacts = findShaclArtifacts(domain, status, versionTag);

  if (shaclArtifacts.length > 0) {
    const [parsed, terms] = await Promise.all([
      Promise.all(shaclArtifacts.map((a) => loadShaclArtifactQuads(a, documentLoader))),
      // Real SHACL files constrain instance data, but say nothing about
      // the class hierarchy itself — that ontology fact still has to come
      // from the domain's own vocabulary/ontology artifacts. Best-effort:
      // an unreachable ontology shouldn't block validation against the
      // (already loaded) real shapes, just mean subclass-target shapes
      // may under-match.
      loadDomainTerms(domain, status, versionTag).catch(() => [] as VocabTerm[]),
    ]);
    return {
      shapeQuads: parsed.flat(),
      estimated: false,
      sourceLabels: shaclArtifacts.map((a) => a.label),
      classHierarchyQuads: buildClassHierarchyQuads(terms),
    };
  }

  const terms = await loadDomainTerms(domain, status, versionTag);
  const shapeQuads = inferShapesFromOntology(terms.map(toOntologyTermLike));
  return {
    shapeQuads,
    estimated: true,
    sourceLabels: [`Inferred from the ${domain.label} ontology (no SHACL file published for this version)`],
    classHierarchyQuads: buildClassHierarchyQuads(terms),
  };
}

/**
 * Loads every published domain's current terms (best-effort — a domain
 * whose vocabulary fails to load is skipped, not fatal) and ranks them by
 * overlap with the given data, for the "detect which domain this data
 * belongs to" step in the standalone/global validator.
 */
/**
 * Detects every domain a data document plausibly belongs to — not just
 * the single best guess — since one document (e.g. an EPCIS document)
 * can legitimately mix terms from several domains at once (GS1 Discovery
 * Service "disco" master-data terms alongside "rail" sensor terms in the
 * same event, say). Two signals are combined:
 *
 *  1. **@context URL matching** (primary, checked first): every string
 *     URL in the document's own top-level @context is compared against
 *     every artifact `url` published in the manifest. A document that
 *     explicitly declares `"@context": ["https://gs1-epcis-reg.org/rail/rail-context.jsonld"]`
 *     is about as strong a signal as exists — the author said which
 *     vocabulary this is. This alone resolves the common case correctly
 *     even before any domain vocabulary has been loaded.
 *  2. **Term-IRI overlap** (secondary, always also run): catches domains
 *     used without an explicit matching @context entry (e.g. terms
 *     brought in via an inline prefix mapping, or a document whose
 *     @context references a *different* URL than the one this manifest
 *     happens to publish for the same vocabulary).
 *
 * Every domain flagged by either signal is returned — callers should
 * treat this as "these domains are all relevant", not "pick the top
 * one". `via` on each match records which signal(s) found it, purely for
 * transparency in the UI (e.g. "detected via @context" vs "detected via
 * term overlap").
 */
export async function detectDomainsForData(
  rawDoc: unknown,
  dataQuads: Quad[],
  manifest: RegistryManifest
): Promise<DomainMatch[]> {
  const urlToDomainSlug = new Map<string, string>();
  for (const domain of manifest.domains) {
    for (const artifact of domain.artifacts) {
      urlToDomainSlug.set(artifact.url, domain.slug);
    }
  }
  const contextSlugs = new Set(
    extractContextUrls(rawDoc)
      .map((url) => urlToDomainSlug.get(url))
      .filter((slug): slug is string => Boolean(slug))
  );

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
  const termMatches = detectLikelyDomains(dataQuads, candidates);
  const termSlugs = new Set(termMatches.map((m) => m.domainSlug));

  const byOverlap = new Map(termMatches.map((m) => [m.domainSlug, m.overlapCount]));
  const allSlugs = new Set([...contextSlugs, ...termSlugs]);

  const combined: DomainMatch[] = Array.from(allSlugs).map((domainSlug) => ({
    domainSlug,
    overlapCount: byOverlap.get(domainSlug) ?? 0,
    via: contextSlugs.has(domainSlug) ? "context" : "terms",
  }));

  // @context matches first (the stronger signal), each tier then by overlap count.
  return combined.sort((a, b) => {
    if (a.via !== b.via) return a.via === "context" ? -1 : 1;
    return b.overlapCount - a.overlapCount;
  });
}

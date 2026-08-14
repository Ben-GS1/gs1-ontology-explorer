import {
  detectLikelyDomains,
  inferShapesFromOntology,
  parseRdfText,
  type DomainCandidate,
  type JsonLdDocumentLoader,
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
  const { quads } = await parseRdfText(text, format, contentType ?? undefined, documentLoader);
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
    const parsed = await Promise.all(shaclArtifacts.map((a) => loadShaclArtifactQuads(a, documentLoader)));
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

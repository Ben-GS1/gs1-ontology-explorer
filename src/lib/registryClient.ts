import { DEFINITIONS_BASE_URL, MANIFEST_PATH, SECTORS_PATH } from "@/config/env";
import type { Artifact, DomainEntry, RegistryManifest, VocabTerm } from "@/types/registry";
import { extractOntologyMetadata, parseVocabularyDocument, type OntologyMetadata } from "./vocabParser";
import type { Gs1Sector } from "@/config/sectors";

export class RegistryFetchError extends Error {
  constructor(message: string, public readonly url: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RegistryFetchError";
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/ld+json, application/json;q=0.9" },
    // GitHub Pages serves static, CDN-cached content — safe to let the
    // browser HTTP cache do its job rather than forcing no-store.
  });
  if (!res.ok) {
    throw new RegistryFetchError(`Request to ${url} failed with ${res.status}`, url);
  }
  return res.json();
}

/** Loads and validates the top-level registry manifest. */
export async function loadManifest(): Promise<RegistryManifest> {
  const url = `${DEFINITIONS_BASE_URL}/${MANIFEST_PATH.replace(/^\//, "")}`;
  try {
    const json = (await fetchJson(url)) as RegistryManifest;
    if (!json || !Array.isArray(json.domains)) {
      throw new RegistryFetchError("Manifest is missing a 'domains' array", url);
    }
    return json;
  } catch (err) {
    if (err instanceof RegistryFetchError) throw err;
    throw new RegistryFetchError("Could not load or parse the registry manifest", url, err);
  }
}

/**
 * Loads the GS1 Sector codelist from the definitions repo
 * (registry/sectors.jsonld — see /sectors.schema.json for the contract).
 * This is the runtime source of truth; src/config/sectors.ts only holds a
 * bundled fallback snapshot used when this fetch fails. Callers should
 * catch and fall back — see useSectors() in src/hooks/useRegistry.ts.
 */
export async function loadSectors(): Promise<Gs1Sector[]> {
  const url = `${DEFINITIONS_BASE_URL}/${SECTORS_PATH.replace(/^\//, "")}`;
  const json = await fetchJson(url);
  if (!Array.isArray(json)) {
    throw new RegistryFetchError("Sector codelist is not an array", url);
  }
  const sectors = json as Gs1Sector[];
  const valid = sectors.every(
    (s) => typeof s?.codeValue === "string" && typeof s?.codeName === "string" && typeof s?.order === "number"
  );
  if (!valid) {
    throw new RegistryFetchError("Sector codelist entries are missing required fields", url);
  }
  return [...sectors].sort((a, b) => a.order - b.order);
}

/** Picks the current (or, failing that, the newest staging) artifact of a given kind. */
export function pickArtifact(
  domain: DomainEntry,
  kind: Artifact["kind"],
  status: Artifact["status"] = "current"
): Artifact | undefined {
  return (
    domain.artifacts.find((a) => a.kind === kind && a.status === status) ??
    domain.artifacts.find((a) => a.kind === kind)
  );
}

/** Loads and parses every JSON-LD vocabulary/ontology artifact for a domain (current version only, by default). */
export async function loadDomainTerms(
  domain: DomainEntry,
  status: Artifact["status"] = "current"
): Promise<VocabTerm[]> {
  const jsonldArtifacts = domain.artifacts.filter(
    (a) => a.status === status && a.mediaType === "application/ld+json" && (a.kind === "vocabulary" || a.kind === "ontology")
  );

  const results = await Promise.allSettled(
    jsonldArtifacts.map(async (artifact) => {
      // Fetch the actual bytes from `source` (e.g. GitHub Pages). `url` is
      // the public canonical identifier — shown/linked to in the UI and
      // used in citations — which may not itself serve raw bytes directly
      // without going through the resolver Function; see README §2c.
      const doc = await fetchJson(artifact.source);
      return parseVocabularyDocument(doc, { domainSlug: domain.slug, sourceArtifactUrl: artifact.url });
    })
  );

  const terms: VocabTerm[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") terms.push(...r.value);
    // A single unreachable artifact shouldn't break the whole domain page;
    // surface it via console so it's visible in monitoring/telemetry.
    else console.warn("[registry] failed to load vocabulary artifact", r.reason);
  }
  return terms;
}

/** Loads the header metadata (title, version, issued date…) from a domain's primary ontology/vocabulary artifact. */
export async function loadDomainMetadata(
  domain: DomainEntry,
  status: Artifact["status"] = "current"
): Promise<OntologyMetadata | undefined> {
  const primary =
    pickArtifact(domain, "ontology", status) ?? pickArtifact(domain, "vocabulary", status);
  if (!primary) return undefined;
  try {
    const doc = await fetchJson(primary.source);
    return extractOntologyMetadata(doc);
  } catch (err) {
    console.warn("[registry] failed to load ontology metadata", err);
    return undefined;
  }
}

/** Builds a cross-domain usage index: term local name/IRI -> domains that define or reference it. */
export function buildCrossReferenceIndex(termsByDomain: Map<string, VocabTerm[]>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const [domainSlug, terms] of termsByDomain) {
    for (const term of terms) {
      const key = term.id;
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(domainSlug);
    }
  }
  return index;
}

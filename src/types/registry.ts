/** Lifecycle state of a published artifact/version. */
export type ArtifactStatus = "current" | "staging" | "deprecated";

/** A single distributable file for a domain (ontology, vocab, SHACL, context, ...). */
export interface Artifact {
  /**
   * Stable, public, dereferenceable identifier under the resolver host,
   * e.g. https://ref.gs1.ch/voc/rail/gs1RailVoc.jsonld. This is
   * the URL other JSON-LD files' @context/@id entries point at, the URL
   * shown/linked to in the UI, and the URL RDF-negotiation redirects to.
   * It never has to correspond to a real path on any physical host — the
   * resolver Function maps it to `source` — so it can stay stable even if
   * the underlying storage/repo layout changes.
   */
  url: string;
  /**
   * Actual physical location the bytes are fetched from today (typically
   * a GitHub Pages URL under the definitions repo). The SPA's own
   * fetch()/CORS calls use this; the resolver Function 303-redirects
   * requests for `url` to this address. Kept separate from `url` on
   * purpose — see the note above.
   */
  source: string;
  /** Media type used for content negotiation, e.g. application/ld+json */
  mediaType: string;
  /** Role of the file within the domain's artifact set. */
  kind: "context" | "ontology" | "vocabulary" | "shacl" | "schema" | "other";
  /** Human label, e.g. "SHACL shapes (generic EPCIS profile)". */
  label: string;
  /** Semver or date-based version identifier. */
  version: string;
  status: ArtifactStatus;
  /** ISO 8601 publication date. */
  publishedAt?: string;
}

/** A domain within a sector, e.g. "rail" within sector TRAN. */
export interface DomainEntry {
  /** URL slug used in resolver paths, e.g. "rail" -> /rail/{term}. */
  slug: string;
  /** i18n key suffix; label text lives in locale files. */
  labelKey: string;
  /** Fallback human label if no i18n resource is loaded yet. */
  label: string;
  description?: string;
  /** Omitted for cross-sector domains published under a "shared" location. */
  sectorCode?: string;
  artifacts: Artifact[];
}

/** Top-level manifest published by the GitHub repository maintainers. */
export interface RegistryManifest {
  "@context"?: unknown;
  generatedAt: string;
  domains: DomainEntry[];
}

/**
 * Language-tagged text: lower-cased BCP 47 tag -> text, e.g. {"en": "Geo", "de": "Geo-Koordinaten"}.
 * Untagged literals are stored under "und" (undetermined).
 */
export type LangMap = Record<string, string>;

/** A single term/class/property extracted from a domain's vocabulary file. */
export interface VocabTerm {
  /** Full IRI of the term. */
  id: string;
  /** Compact local name, e.g. "wagonNumber". */
  localName: string;
  /** Display label in the default content language (English, else untagged, else the first available). Use `labels` + localizeTerm() for a specific language. */
  label: string;
  /** Description in the default content language — see `label`. */
  description?: string;
  /** All translations of the label (rdfs:label / skos:prefLabel / dct:title), keyed by language tag. Absent when the term has no label at all. */
  labels?: LangMap;
  /** All translations of the description (rdfs:comment / skos:definition / dct:description), keyed by language tag. */
  descriptions?: LangMap;
  /** rdf:type values, e.g. ["rdfs:Class"] or ["rdf:Property"]. */
  types: string[];
  domainSlug: string;
  sourceArtifactUrl: string;
  /**
   * IRIs of related resources, keyed by the *canonical* predicate (always the CURIE form,
   * e.g. "rdfs:domain", even if the source file used the compact term "domain"):
   * rdfs:domain / range / subClassOf / subPropertyOf / isDefinedBy / seeAlso,
   * owl:equivalent*, skos:broader / narrower / related / inScheme, sai:usedWithLinkType.
   */
  relations: Record<string, string[]>;
  /** Optional lifecycle marker some GS1 vocabularies carry per-term (sw:term_status). */
  termStatus?: "stable" | "deprecated" | "reserved" | string;
  /** owl:versionInfo of the term itself, where it carries one. */
  versionInfo?: string;
  /** dct:created (typically an xsd:date such as "2025-10-23"). */
  created?: string;
  /** dct:license — an IRI, where the term declares its own license. */
  license?: string;
  /** Unit of measure code (e.g. UN/CEFACT Recommendation 20 "KMH"), from schema:unitCode/schema:unitText, where the term declares one. */
  unitCode?: string;
  /** Raw JSON-LD node, kept for a "view source" panel. */
  raw: Record<string, unknown>;
}

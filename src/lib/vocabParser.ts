import type { LangMap, VocabTerm } from "@/types/registry";
import { DEFAULT_CONTENT_LANGUAGE, mergeLangMaps, normalizeLangTag, pickLocalized, UNDETERMINED } from "./localized";

/**
 * Generic, schema-agnostic extraction of human-readable terms from a
 * JSON-LD document (OWL ontology, SKOS vocabulary, or plain RDFS vocab).
 * We deliberately avoid hard-coding any GS1-specific vocabulary shape:
 * the SPA must render *any* JSON-LD published under the manifest, in the
 * spirit of how schema.org's term pages work off a single generic template.
 *
 * Strategy: flatten @graph (or treat the root as a single node / array of
 * nodes), then for every node that looks like a class/property/concept
 * (has an @id and a recognisable @type, or carries rdfs:label /
 * skos:prefLabel), build a VocabTerm. Label/description resolution checks
 * a prioritised list of common predicates so it works across OWL, RDFS
 * and SKOS vocabularies without per-file configuration.
 *
 * A property can appear on a node under several spellings, because the
 * same predicate may be written as a CURIE ("rdfs:label"), as a compact
 * term from a (remote) @context ("label"), or fully expanded. Every
 * predicate below is therefore declared once, as a list of accepted keys
 * (see keyAliases()), and always surfaced under its canonical CURIE.
 *
 * Translations: literals may be plain strings, {"@language","@value"}
 * objects, or JSON-LD language maps ({"en": "…", "de": "…"}, i.e. a term
 * defined with `"@container": "@language"`). All of them end up as a
 * LangMap (language tag -> text) — see extractLocalized().
 */

// Namespaces whose CURIEs we also recognise in fully-expanded form
// (e.g. a node keyed by "http://www.w3.org/2000/01/rdf-schema#label").
const WELL_KNOWN_NS: Record<string, string[]> = {
  rdfs: ["http://www.w3.org/2000/01/rdf-schema#"],
  owl: ["http://www.w3.org/2002/07/owl#"],
  skos: ["http://www.w3.org/2004/02/skos/core#"],
  dct: ["http://purl.org/dc/terms/"],
  dcterms: ["http://purl.org/dc/terms/"],
  dc: ["http://purl.org/dc/elements/1.1/", "http://purl.org/dc/terms/"],
};

/**
 * All spellings under which a predicate may appear on a node: the given
 * CURIEs and compact terms, plus the expanded IRI of each well-known CURIE.
 * Order is preserved and is the lookup priority.
 */
function keyAliases(...keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    out.push(key);
    const colon = key.indexOf(":");
    const bases = colon > 0 ? WELL_KNOWN_NS[key.slice(0, colon)] : undefined;
    for (const base of bases ?? []) out.push(base + key.slice(colon + 1));
  }
  return Array.from(new Set(out));
}

// Compact terms ("label", "comment", "title", "description", …) are the
// names GS1's own @context gives to these predicates.
const TITLE_KEYS = keyAliases("dct:title", "dcterms:title", "dc:title", "title");
const LABEL_KEYS = [...keyAliases("rdfs:label", "label"), ...keyAliases("skos:prefLabel"), ...TITLE_KEYS, "name"];
const DESCRIPTION_KEYS = [
  ...keyAliases("rdfs:comment", "comment"),
  ...keyAliases("skos:definition"),
  ...keyAliases("dct:description", "dcterms:description", "dc:description", "description"),
];
const TYPE_LIKE_KEYS = ["@type", "type"];
// schema:unitCode is the one actually seen in GS1's real vocab files
// (e.g. rail:en15654Speed carries "schema:unitCode": "KMH"); the others
// are included defensively since this extraction is meant to work across
// any vocabulary, not just ones we've inspected.
const UNIT_PREDICATES = ["schema:unitCode", "schema:unitText", "qudt:unit", "sh:unit"];

const TERM_STATUS_KEYS = ["sw:term_status", "termStatus"];
const VERSION_INFO_KEYS = keyAliases("owl:versionInfo", "versionInfo");
const CREATED_KEYS = keyAliases("dct:created", "dcterms:created", "dc:created", "created");
const ISSUED_KEYS = keyAliases("dct:issued", "dcterms:issued", "dc:issued", "issued");
const MODIFIED_KEYS = ["dc:lastModified", ...keyAliases("dct:modified", "dcterms:modified", "modified")];
const LICENSE_KEYS = keyAliases("dct:license", "dcterms:license", "license", "schema:license");

/** canonical predicate (CURIE) -> every key it may appear under. Values are IRIs (or CURIEs the document's own @context couldn't expand). */
const RELATION_KEYS: Record<string, string[]> = {
  "rdfs:domain": keyAliases("rdfs:domain", "domain"),
  "rdfs:range": keyAliases("rdfs:range", "range"),
  "rdfs:subClassOf": keyAliases("rdfs:subClassOf", "subClassOf"),
  "rdfs:subPropertyOf": keyAliases("rdfs:subPropertyOf", "subPropertyOf"),
  "owl:equivalentClass": keyAliases("owl:equivalentClass", "equivalentClass"),
  "owl:equivalentProperty": keyAliases("owl:equivalentProperty", "equivalentProperty"),
  "skos:broader": keyAliases("skos:broader", "broader"),
  "skos:narrower": keyAliases("skos:narrower", "narrower"),
  "skos:related": keyAliases("skos:related", "related"),
  "skos:inScheme": keyAliases("skos:inScheme", "inScheme"),
  "rdfs:isDefinedBy": keyAliases("rdfs:isDefinedBy", "isDefinedBy"),
  "sai:usedWithLinkType": keyAliases("sai:usedWithLinkType", "usedWithLinkType"),
  "rdfs:seeAlso": keyAliases("rdfs:seeAlso", "seeAlso"),
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Builds a prefix -> IRI map from a JSON-LD @context (which may be an
 * object, an array mixing remote context URLs and an inline object, or
 * absent entirely). Only simple string-valued prefix definitions are
 * collected — e.g. {"rail": "https://.../data#"} — since that's all a
 * compact-IRI ("CURIE") expansion needs; term definitions with expanded
 * @id/@type mappings are left to the (optional, network-dependent) full
 * JSON-LD processor and are not required for human-readable rendering.
 * We deliberately never fetch remote @context URLs here: GS1's contexts
 * chain to external hosts that may be unreachable or rate-limited, and
 * this app must keep working (with un-expanded CURIEs as a fallback) even
 * when they are.
 */
function buildPrefixMap(doc: unknown): Record<string, string> {
  const prefixes: Record<string, string> = {};
  const contexts = Array.isArray(doc) ? [] : asArray((doc as Record<string, unknown> | undefined)?.["@context"]);
  for (const ctx of contexts) {
    if (!ctx || typeof ctx !== "object") continue; // skip remote context URL strings
    for (const [key, value] of Object.entries(ctx as Record<string, unknown>)) {
      if (key.startsWith("@")) continue;
      if (typeof value === "string" && !value.startsWith("@")) {
        prefixes[key] = value;
      } else if (value && typeof value === "object" && typeof (value as Record<string, unknown>)["@id"] === "string") {
        prefixes[key] = (value as Record<string, unknown>)["@id"] as string;
      }
    }
  }
  return prefixes;
}

/** Expands a compact IRI ("rail:geo") to a full IRI using the document's @context prefix map, if possible. */
function expandCurie(value: string, prefixMap: Record<string, string>): string {
  if (value.startsWith("_:") || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value; // already absolute or a blank node
  const colonIdx = value.indexOf(":");
  if (colonIdx < 0) return value;
  const prefix = value.slice(0, colonIdx);
  const local = value.slice(colonIdx + 1);
  const base = prefixMap[prefix];
  return base ? `${base}${local}` : value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractString(node: Record<string, unknown>, predicates: string[]): string | undefined {
  for (const pred of predicates) {
    const raw = node[pred];
    if (raw === undefined) continue;
    const values = asArray(raw);
    for (const v of values) {
      if (typeof v === "string") return v;
      if (v && typeof v === "object" && "@value" in (v as Record<string, unknown>)) {
        const val = (v as Record<string, unknown>)["@value"];
        if (typeof val === "string") return val;
      }
    }
  }
  return undefined;
}

/** Collects every literal under `raw` as language -> texts, in document order. */
function collectLiterals(raw: unknown, lang: string, out: Record<string, string[]>): void {
  if (raw === undefined || raw === null) return;
  if (Array.isArray(raw)) {
    for (const item of raw) collectLiterals(item, lang, out);
    return;
  }
  if (typeof raw === "string") {
    if (raw.trim() !== "") (out[lang] ??= []).push(raw);
    return;
  }
  if (!isRecord(raw)) return;

  if ("@value" in raw) {
    // {"@language": "de", "@value": "…"} — an explicit tag overrides whatever the surrounding map says.
    const value = raw["@value"];
    const tag = "@language" in raw ? normalizeLangTag(raw["@language"]) ?? lang : lang;
    if (typeof value === "string" && value.trim() !== "") (out[tag] ??= []).push(value);
    return;
  }
  if ("@id" in raw) return; // an IRI reference, not a literal
  if ("@list" in raw) return collectLiterals(raw["@list"], lang, out);
  if ("@set" in raw) return collectLiterals(raw["@set"], lang, out);

  // Anything else is a JSON-LD language map: {"en": …, "de": …} (`@container: @language`).
  for (const [key, value] of Object.entries(raw)) {
    const tag = normalizeLangTag(key);
    if (tag) collectLiterals(value, tag, out);
  }
}

/**
 * Reads a translatable property (label, comment, title, …) as a LangMap.
 * `keys` is in priority order: for a language defined under several of
 * them, the earlier key wins, but each language is still kept — so a term
 * with an rdfs:label in English and a dct:title in German shows both.
 * Several values in one language keep the first, or are joined into
 * paragraphs when `joinMultiple` is set (for longer descriptions).
 */
function extractLocalized(node: Record<string, unknown>, keys: string[], joinMultiple = false): LangMap {
  const perKey = keys.map((key) => {
    const literals: Record<string, string[]> = {};
    collectLiterals(node[key], UNDETERMINED, literals);
    const map: LangMap = {};
    for (const [lang, texts] of Object.entries(literals)) map[lang] = joinMultiple ? texts.join("\n\n") : texts[0];
    return map;
  });
  return mergeLangMaps(...perKey);
}

function defaultText(map: LangMap): string | undefined {
  return pickLocalized(map, [DEFAULT_CONTENT_LANGUAGE])?.text;
}

/** IRIs under any of `keys` — accepts {"@id"} objects as well as plain strings (the `@type: @id` coercion of a remote @context isn't applied here). */
function extractIds(node: Record<string, unknown>, keys: string[], prefixMap: Record<string, string>): string[] {
  const ids: string[] = [];
  for (const key of keys) {
    for (const v of asArray(node[key])) {
      if (typeof v === "string") ids.push(expandCurie(v, prefixMap));
      else if (isRecord(v) && "@id" in v) ids.push(expandCurie(String(v["@id"]), prefixMap));
    }
  }
  return Array.from(new Set(ids));
}

function extractRelations(node: Record<string, unknown>, prefixMap: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [canonical, keys] of Object.entries(RELATION_KEYS)) {
    const ids = extractIds(node, keys, prefixMap);
    if (ids.length) out[canonical] = ids;
  }
  return out;
}

function localNameOf(iri: string): string {
  const hashIdx = iri.lastIndexOf("#");
  const slashIdx = iri.lastIndexOf("/");
  const cut = Math.max(hashIdx, slashIdx);
  if (cut >= 0) return iri.slice(cut + 1);
  // Compact IRIs (CURIEs) like "rail:geo" have no '/' or '#' — fall back to
  // the segment after the last ':' (but not for full "scheme://" URLs,
  // which are already handled by the slash check above).
  const colonIdx = iri.lastIndexOf(":");
  return colonIdx >= 0 ? iri.slice(colonIdx + 1) : iri;
}

function collectNodes(doc: unknown): Record<string, unknown>[] {
  if (Array.isArray(doc)) return doc.flatMap(collectNodes);
  if (doc && typeof doc === "object") {
    const obj = doc as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      return (obj["@graph"] as unknown[]).flatMap(collectNodes);
    }
    if ("@id" in obj || "@type" in obj) return [obj];
  }
  return [];
}

const ONTOLOGY_HEADER_TYPES = ["voaf:Vocabulary", "owl:Ontology", "http://www.w3.org/2002/07/owl#Ontology"];

/** True for the single node that describes the vocabulary/ontology itself (title, license, version…), not a term. */
function isOntologyHeaderNode(types: string[]): boolean {
  return types.some((t) => ONTOLOGY_HEADER_TYPES.includes(t));
}

export interface OntologyMetadata {
  id: string;
  /** Title in the default content language; see `titles` for every translation. */
  title?: string;
  /** Description in the default content language; see `descriptions` for every translation. */
  description?: string;
  titles?: LangMap;
  descriptions?: LangMap;
  version?: string;
  issued?: string;
  lastModified?: string;
  preferredPrefix?: string;
  license?: string;
}

/** Extracts the single ontology/vocabulary header node (title, version, license…) if present. */
export function extractOntologyMetadata(doc: unknown): OntologyMetadata | undefined {
  const nodes = collectNodes(doc);
  const prefixMap = buildPrefixMap(doc);
  for (const node of nodes) {
    const id = node["@id"];
    if (typeof id !== "string") continue;
    const types = TYPE_LIKE_KEYS.flatMap((k) => asArray(node[k] as string | string[]).map(String));
    if (!isOntologyHeaderNode(types)) continue;

    // The header's own name is its title; rdfs:label is only a fallback for headers that have no title.
    const titles = extractLocalized(node, [...TITLE_KEYS, ...keyAliases("rdfs:label", "label")]);
    const descriptions = extractLocalized(node, DESCRIPTION_KEYS, true);
    return {
      id: expandCurie(id, prefixMap),
      title: defaultText(titles),
      description: defaultText(descriptions),
      titles: Object.keys(titles).length ? titles : undefined,
      descriptions: Object.keys(descriptions).length ? descriptions : undefined,
      version: extractString(node, VERSION_INFO_KEYS),
      issued: extractString(node, [...ISSUED_KEYS, ...CREATED_KEYS]),
      lastModified: extractString(node, MODIFIED_KEYS),
      preferredPrefix: extractString(node, ["vann:preferredNamespacePrefix"]),
      license: extractIds(node, LICENSE_KEYS, prefixMap)[0],
    };
  }
  return undefined;
}

export function parseVocabularyDocument(
  doc: unknown,
  opts: { domainSlug: string; sourceArtifactUrl: string }
): VocabTerm[] {
  const nodes = collectNodes(doc);
  const prefixMap = buildPrefixMap(doc);
  const terms: VocabTerm[] = [];

  for (const node of nodes) {
    const rawId = node["@id"];
    if (typeof rawId !== "string") continue;
    // Skip blank nodes.
    if (rawId.startsWith("_:")) continue;

    const rawTypes = TYPE_LIKE_KEYS.flatMap((k) => asArray(node[k] as string | string[]).map(String));
    // The ontology header node (e.g. "rail:" typed voaf:Vocabulary/owl:Ontology)
    // describes the vocabulary as a whole, not a browsable term — it's
    // surfaced separately via extractOntologyMetadata() below.
    if (isOntologyHeaderNode(rawTypes)) continue;
    const types = rawTypes.map((ty) => expandCurie(ty, prefixMap));

    const id = expandCurie(rawId, prefixMap);
    const labels = extractLocalized(node, LABEL_KEYS);
    const descriptions = extractLocalized(node, DESCRIPTION_KEYS, true);
    const label = defaultText(labels) ?? localNameOf(rawId);
    const description = defaultText(descriptions);
    const relations = extractRelations(node, prefixMap);
    const termStatus = extractString(node, TERM_STATUS_KEYS);
    const unitCode = extractString(node, UNIT_PREDICATES);

    terms.push({
      id,
      // localName is derived from the original (possibly compact) id so URL
      // slugs stay short and stable, e.g. "rail:geo" -> "geo", regardless of
      // whether the prefix could be expanded.
      localName: localNameOf(rawId),
      label,
      description,
      labels: Object.keys(labels).length ? labels : undefined,
      descriptions: Object.keys(descriptions).length ? descriptions : undefined,
      types,
      domainSlug: opts.domainSlug,
      sourceArtifactUrl: opts.sourceArtifactUrl,
      relations,
      termStatus,
      versionInfo: extractString(node, VERSION_INFO_KEYS),
      created: extractString(node, CREATED_KEYS),
      license: extractIds(node, LICENSE_KEYS, prefixMap)[0],
      unitCode,
      raw: node,
    });
  }

  // De-duplicate by @id (a term can legitimately appear more than once
  // across @graph entries, e.g. once in the context and once in the vocab).
  const byId = new Map<string, VocabTerm>();
  for (const t of terms) {
    const existing = byId.get(t.id);
    if (!existing) {
      byId.set(t.id, t);
    } else {
      const labels = mergeLangMaps(existing.labels, t.labels);
      const descriptions = mergeLangMaps(existing.descriptions, t.descriptions);
      byId.set(t.id, {
        ...existing,
        // Recomputed from the merged translations: the first occurrence may have had no label at all.
        label: defaultText(labels) ?? existing.label,
        description: defaultText(descriptions) ?? existing.description,
        labels: Object.keys(labels).length ? labels : undefined,
        descriptions: Object.keys(descriptions).length ? descriptions : undefined,
        types: Array.from(new Set([...existing.types, ...t.types])),
        relations: { ...t.relations, ...existing.relations },
        termStatus: existing.termStatus ?? t.termStatus,
        versionInfo: existing.versionInfo ?? t.versionInfo,
        created: existing.created ?? t.created,
        license: existing.license ?? t.license,
        unitCode: existing.unitCode ?? t.unitCode,
      });
    }
  }
  return Array.from(byId.values());
}

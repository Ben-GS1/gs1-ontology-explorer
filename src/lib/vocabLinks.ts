function localName(iri: string): string {
  const withoutPrefix = iri.includes(":") && !iri.startsWith("http") ? iri.split(":").slice(1).join(":") : iri;
  const hashIdx = withoutPrefix.lastIndexOf("#");
  const slashIdx = withoutPrefix.lastIndexOf("/");
  const cut = Math.max(hashIdx, slashIdx);
  return cut >= 0 ? withoutPrefix.slice(cut + 1) : withoutPrefix;
}

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL_NS = "http://www.w3.org/2002/07/owl#";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/**
 * Maps a type IRI — compact ("gs1:MeasurementType") or fully expanded
 * ("https://gs1.org/voc/MeasurementType") — to an external, human-readable
 * definition page, where one is reliably known. Types are commonly left
 * compact by the parser when their prefix is only defined in a *remote*
 * @context we deliberately don't fetch (see vocabParser.ts's comment on
 * why) — so this has to recognise both forms, not just fully-expanded IRIs.
 *
 * Returns undefined when no known mapping applies, rather than guessing;
 * callers should render the type as plain text in that case.
 */
export function resolveTypeDefinitionUrl(typeIri: string): string | undefined {
  // schema.org — the type's own IRI is already the canonical, browsable page.
  if (typeIri.startsWith("schema:")) return `https://schema.org/${localName(typeIri)}`;
  if (typeIri.includes("schema.org/")) return typeIri;

  // GS1 Web Vocabulary — documentation lives at ref.gs1.org/voc/, which is
  // not necessarily the same host as the RDF namespace IRI itself.
  if (typeIri.startsWith("gs1:")) return `https://ref.gs1.org/voc/${localName(typeIri)}`;
  if (typeIri.includes("gs1.org/voc/") || typeIri.includes("ref.gs1.org/voc/")) {
    return `https://ref.gs1.org/voc/${localName(typeIri)}`;
  }

  // Core W3C vocabularies — their own namespace IRI is the spec anchor.
  if (typeIri.startsWith("rdf:")) return RDF_NS + localName(typeIri);
  if (typeIri.startsWith(RDF_NS)) return typeIri;
  if (typeIri.startsWith("rdfs:")) return RDFS_NS + localName(typeIri);
  if (typeIri.startsWith(RDFS_NS)) return typeIri;
  if (typeIri.startsWith("owl:")) return OWL_NS + localName(typeIri);
  if (typeIri.startsWith(OWL_NS)) return typeIri;
  if (typeIri.startsWith("xsd:")) return XSD_NS + localName(typeIri);
  if (typeIri.startsWith(XSD_NS)) return typeIri;

  // Any other already-expanded absolute IRI is, per Linked Data
  // convention, generally dereferenceable at its own address.
  if (/^https?:\/\//.test(typeIri)) return typeIri;

  // Still a compact CURIE with an unknown/unexpandable prefix — no
  // reliable link can be built.
  return undefined;
}

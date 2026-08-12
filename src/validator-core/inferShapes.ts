import { DataFactory } from "n3";
import type { Quad } from "n3";

const { namedNode, blankNode, literal, quad } = DataFactory;

const SH = "http://www.w3.org/ns/shacl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const XSD_DATATYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#string",
  "http://www.w3.org/2001/XMLSchema#date",
  "http://www.w3.org/2001/XMLSchema#dateTime",
  "http://www.w3.org/2001/XMLSchema#dateTimeStamp",
  "http://www.w3.org/2001/XMLSchema#decimal",
  "http://www.w3.org/2001/XMLSchema#integer",
  "http://www.w3.org/2001/XMLSchema#boolean",
  "http://www.w3.org/2001/XMLSchema#double",
  "http://www.w3.org/2001/XMLSchema#float",
  "http://www.w3.org/2001/XMLSchema#anyURI",
  "http://www.w3.org/2001/XMLSchema#time",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
]);
// Fallback for compact "xsd:xxx" forms that didn't get expanded (e.g. no
// inline @context prefix for "xsd" in the source vocabulary).
const XSD_CURIE_PREFIX = "xsd:";
const XSD_BASE = "http://www.w3.org/2001/XMLSchema#";

/**
 * Minimal shape of a parsed ontology term this module needs — deliberately
 * NOT the app's VocabTerm type, to keep validator-core free of any
 * dependency on the rest of the app. src/lib/shaclAdapter.ts maps
 * VocabTerm[] to this shape before calling in.
 */
export interface OntologyTermLike {
  id: string;
  label?: string;
  types: string[];
  relations: Record<string, string[]>;
}

function isClassType(types: string[]): boolean {
  return types.some((t) => /(^|[#/:])Class$/.test(t));
}

function isPropertyType(types: string[]): boolean {
  return types.some((t) => /(^|[#/:])(Property|DatatypeProperty|ObjectProperty)$/.test(t));
}

function resolveDatatypeIri(range: string): string | undefined {
  if (XSD_DATATYPES.has(range)) return range;
  if (range.startsWith(XSD_CURIE_PREFIX)) {
    const candidate = XSD_BASE + range.slice(XSD_CURIE_PREFIX.length);
    return XSD_DATATYPES.has(candidate) ? candidate : candidate; // still a reasonable guess even if not in our known set
  }
  return undefined;
}

/**
 * Derives a best-effort SHACL shapes graph from plain OWL/RDFS terms:
 * one sh:NodeShape per owl:Class/rdfs:Class (targetClass = that class),
 * with one sh:property per property whose rdfs:domain includes the
 * class, constrained by sh:datatype (literal ranges) or sh:class (object
 * ranges) where a range is stated at all.
 *
 * Deliberately conservative: no sh:minCount/sh:maxCount are emitted,
 * because plain RDFS/OWL (without explicit owl:Restriction cardinality
 * axioms, which this app's ontology parser doesn't currently extract)
 * gives no reliable basis for cardinality — a shape that guesses
 * cardinality wrong is worse than one that states less. Callers MUST
 * present shapes produced by this function to the user as estimated /
 * inferred, not as authoritative — see the "estimated" flag threaded
 * through src/lib/shaclAdapter.ts and shown in the validator UI.
 */
export function inferShapesFromOntology(terms: OntologyTermLike[]): Quad[] {
  const quads: Quad[] = [];
  const classes = terms.filter((t) => isClassType(t.types));
  const properties = terms.filter((t) => isPropertyType(t.types));

  const propsByDomainClass = new Map<string, OntologyTermLike[]>();
  for (const prop of properties) {
    for (const domainIri of prop.relations["rdfs:domain"] ?? []) {
      if (!propsByDomainClass.has(domainIri)) propsByDomainClass.set(domainIri, []);
      propsByDomainClass.get(domainIri)!.push(prop);
    }
  }

  for (const cls of classes) {
    const shapeNode = blankNode();
    quads.push(quad(shapeNode, namedNode(RDF_TYPE), namedNode(SH + "NodeShape")));
    quads.push(quad(shapeNode, namedNode(SH + "targetClass"), namedNode(cls.id)));
    if (cls.label) quads.push(quad(shapeNode, namedNode(SH + "name"), literal(cls.label)));

    for (const prop of propsByDomainClass.get(cls.id) ?? []) {
      const propShape = blankNode();
      quads.push(quad(shapeNode, namedNode(SH + "property"), propShape));
      quads.push(quad(propShape, namedNode(SH + "path"), namedNode(prop.id)));
      if (prop.label) quads.push(quad(propShape, namedNode(SH + "name"), literal(prop.label)));

      for (const range of prop.relations["rdfs:range"] ?? []) {
        const datatypeIri = resolveDatatypeIri(range);
        if (datatypeIri) {
          quads.push(quad(propShape, namedNode(SH + "datatype"), namedNode(datatypeIri)));
        } else if (/^https?:\/\//.test(range)) {
          quads.push(quad(propShape, namedNode(SH + "class"), namedNode(range)));
        }
      }
    }
  }

  return quads;
}

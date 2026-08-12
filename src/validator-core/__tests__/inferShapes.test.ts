import { describe, expect, it } from "vitest";
import { inferShapesFromOntology, type OntologyTermLike } from "../inferShapes";
import { validate } from "../shaclEngine";
import { parseJsonLd } from "../rdf";

const railTerms: OntologyTermLike[] = [
  { id: "http://ex.org/rail#Wagon", label: "Wagon", types: ["owl:Class"], relations: {} },
  {
    id: "http://ex.org/rail#wagonNumber",
    label: "Wagon number",
    types: ["owl:DatatypeProperty"],
    relations: {
      "rdfs:domain": ["http://ex.org/rail#Wagon"],
      "rdfs:range": ["http://www.w3.org/2001/XMLSchema#string"],
    },
  },
  {
    id: "http://ex.org/rail#operator",
    label: "Operator",
    types: ["owl:ObjectProperty"],
    relations: {
      "rdfs:domain": ["http://ex.org/rail#Wagon"],
      "rdfs:range": ["http://ex.org/rail#Company"],
    },
  },
];

describe("inferShapesFromOntology", () => {
  it("creates one NodeShape per class, targeting that class", () => {
    const quads = inferShapesFromOntology(railTerms);
    const targetClassQuads = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#targetClass");
    expect(targetClassQuads).toHaveLength(1);
    expect(targetClassQuads[0].object.value).toBe("http://ex.org/rail#Wagon");
  });

  it("attaches a property shape per property whose rdfs:domain matches the class", () => {
    const quads = inferShapesFromOntology(railTerms);
    const pathQuads = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#path");
    const paths = pathQuads.map((q) => q.object.value).sort();
    expect(paths).toEqual(["http://ex.org/rail#operator", "http://ex.org/rail#wagonNumber"]);
  });

  it("uses sh:datatype for literal ranges and sh:class for object ranges", () => {
    const quads = inferShapesFromOntology(railTerms);
    const datatypeQuads = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#datatype");
    const classConstraintQuads = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#class");
    expect(datatypeQuads).toHaveLength(1);
    expect(datatypeQuads[0].object.value).toBe("http://www.w3.org/2001/XMLSchema#string");
    expect(classConstraintQuads).toHaveLength(1);
    expect(classConstraintQuads[0].object.value).toBe("http://ex.org/rail#Company");
  });

  it("never emits sh:minCount / sh:maxCount — cardinality is deliberately not guessed", () => {
    const quads = inferShapesFromOntology(railTerms);
    const cardinalityQuads = quads.filter(
      (q) =>
        q.predicate.value === "http://www.w3.org/ns/shacl#minCount" ||
        q.predicate.value === "http://www.w3.org/ns/shacl#maxCount"
    );
    expect(cardinalityQuads).toHaveLength(0);
  });

  it("produces a shapes graph that rdf-validate-shacl can actually run against real data", async () => {
    const shapeQuads = inferShapesFromOntology(railTerms);
    const data = {
      "@context": { rail: "http://ex.org/rail#", wagonNumber: "rail:wagonNumber", Wagon: "rail:Wagon" },
      "@id": "rail:w1",
      "@type": "Wagon",
      wagonNumber: "12345",
    };
    const dataQuads = await parseJsonLd(data);
    const report = await validate(shapeQuads, dataQuads);
    expect(report.conforms).toBe(true);
  });
});

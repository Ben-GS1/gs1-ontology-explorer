import { describe, expect, it } from "vitest";
import { parseJsonLd, parseRdfText, parseTurtle, sniffFormat } from "../rdf";
import { validate } from "../shaclEngine";

const personShapeTtl = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <http://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
  ] .
`;

const validPersonData = {
  "@context": { ex: "http://example.org/", name: "ex:name", Person: "ex:Person" },
  "@graph": [{ "@id": "ex:alice", "@type": "Person", name: "Alice" }],
};

const invalidPersonData = {
  "@context": { ex: "http://example.org/", name: "ex:name", Person: "ex:Person" },
  "@graph": [
    { "@id": "ex:alice", "@type": "Person", name: "Alice" },
    { "@id": "ex:bob", "@type": "Person" },
  ],
};

describe("parseTurtle / parseJsonLd", () => {
  it("parses Turtle into quads", () => {
    const quads = parseTurtle(personShapeTtl);
    expect(quads.length).toBeGreaterThan(0);
  });

  it("parses JSON-LD into quads", async () => {
    const quads = await parseJsonLd(validPersonData);
    // 1 rdf:type triple + 1 name triple
    expect(quads.length).toBe(2);
  });

  it("sniffFormat detects JSON-LD by leading brace and Turtle otherwise", () => {
    expect(sniffFormat('{"@context":{}}')).toBe("jsonld");
    expect(sniffFormat("@prefix ex: <http://example.org/> .")).toBe("turtle");
  });

  it("parseRdfText auto-detects format when none given", async () => {
    const { format, quads } = await parseRdfText(JSON.stringify(validPersonData));
    expect(format).toBe("jsonld");
    expect(quads.length).toBe(2);
  });
});

describe("validate (rdf-validate-shacl integration)", () => {
  it("reports conforms=true for data satisfying the shape", async () => {
    const shapeQuads = parseTurtle(personShapeTtl);
    const dataQuads = await parseJsonLd(validPersonData);
    const report = await validate(shapeQuads, dataQuads);
    expect(report.conforms).toBe(true);
    expect(report.results).toHaveLength(0);
    expect(report.counts).toEqual({ violations: 0, warnings: 0, infos: 0 });
  });

  it("reports a violation with a useful message/focusNode/path for data missing a required property", async () => {
    const shapeQuads = parseTurtle(personShapeTtl);
    const dataQuads = await parseJsonLd(invalidPersonData);
    const report = await validate(shapeQuads, dataQuads);

    expect(report.conforms).toBe(false);
    expect(report.counts.violations).toBe(1);
    const [result] = report.results;
    expect(result.focusNode).toBe("http://example.org/bob");
    expect(result.path).toBe("http://example.org/name");
    expect(result.severity).toBe("Violation");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

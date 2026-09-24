import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DataFactory } from "n3";
import { parseRdfText, validate, type JsonLdDocumentLoader } from "@/validator-core";
import { buildClassHierarchyQuads } from "@/lib/shaclAdapter";
import type { VocabTerm } from "@/types/registry";

/**
 * These fixtures are real files supplied while debugging why the Validate
 * tab "didn't work": an EPCIS instance document and a hand-written SHACL
 * shapes file for the same rail domain. Running the real engine against
 * them (see the investigation that produced this test) surfaced three
 * separate, independently-confirmed bugs, each covered below:
 *
 *  1. rdf.ts (parseRdfText/parseJsonLd) — a JSON-LD SHACL shapes document
 *     whose own @context doesn't separately declare @id-typing for
 *     sh:targetClass/sh:path/etc. (this one doesn't) parsed those values
 *     as plain string literals instead of IRIs, so every shape matched
 *     zero nodes and validation trivially, silently "conformed" —
 *     look for the actual literal-vs-IRI assertions further down for how
 *     it presents when the fix is absent, not just its end effect.
 *  2. shaclEngine.ts (validate) — a shape using a SHACL-SPARQL constraint
 *     (this file's MasterDataLinkShape) crashed the *entire* validation
 *     run, since the underlying engine doesn't support SHACL-SPARQL at
 *     all — and ValidatePage.tsx had no error handling around the call,
 *     so that crash was invisible to the user.
 *  3. shaclAdapter.ts (buildClassHierarchyQuads) — SHACL's sh:targetClass
 *     is defined to also match instances of *subclasses* of the named
 *     class, but only via rdfs:subClassOf facts present in the data
 *     graph specifically. EPCIS instance data always uses a concrete
 *     event subtype (ObjectEvent, etc.) as rdf:type, never the abstract
 *     "EPCISEvent" this file's shapes target directly — so without those
 *     facts merged in, targeting the abstract class (a very common,
 *     reasonable way to write one shape covering every event type) never
 *     matches real data at all.
 */
const fixtureText = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

const dataDoc = JSON.parse(fixtureText("SHACL_ValidationTest.json"));
const shapesDoc = JSON.parse(fixtureText("Rail-EPCIS-SHACL-Generic.json"));

// Stands in for the real (network-unreachable-from-tests) rail-context.jsonld
// this fixture's own @context references, mirroring EPCIS 2.0 JSON-LD
// convention (type -> @type, concrete event subclasses as terms) plus the
// rail/gs1 extension terms this specific document actually uses.
const EPCIS = "https://ref.gs1.org/epcis/";
const GS1 = "https://gs1.org/voc/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const railContext = {
  epcis: EPCIS,
  gs1: GS1,
  schema: "https://schema.org/",
  xsd: XSD,
  type: "@type",
  id: "@id",
  EPCISDocument: EPCIS + "EPCISDocument",
  epcisBody: { "@id": EPCIS + "epcisBody", "@type": "@id" },
  eventList: { "@id": EPCIS + "eventList", "@container": "@list" },
  schemaVersion: EPCIS + "schemaVersion",
  creationDate: { "@id": EPCIS + "creationDate", "@type": "xsd:dateTime" },
  ObjectEvent: EPCIS + "ObjectEvent",
  AggregationEvent: EPCIS + "AggregationEvent",
  AssociationEvent: EPCIS + "AssociationEvent",
  TransactionEvent: EPCIS + "TransactionEvent",
  TransformationEvent: EPCIS + "TransformationEvent",
  action: EPCIS + "action",
  eventTime: { "@id": EPCIS + "eventTime", "@type": "xsd:dateTime" },
  eventTimeZoneOffset: { "@id": EPCIS + "eventTimeZoneOffset", "@type": "xsd:string" },
  epcList: { "@id": EPCIS + "epcList", "@type": "@id", "@container": "@list" },
  eventID: EPCIS + "eventID",
  bizTransactionList: { "@id": EPCIS + "bizTransactionList", "@container": "@list" },
  bizTransaction: { "@id": EPCIS + "bizTransaction", "@type": "@id" },
  masterDataAvailableFor: { "@id": GS1 + "masterDataAvailableFor", "@container": "@list" },
  licenceKey: GS1 + "licenceKey",
  licenseeName: GS1 + "licenseeName",
  keyRecordStatus: GS1 + "keyRecordStatus",
  errorCode: "https://schema.org/errorCode",
  target: { "@id": "https://schema.org/target", "@type": "@id" },
  vbgmessage: GS1 + "vbgmessage",
};

const documentLoader: JsonLdDocumentLoader = async (url) => {
  if (url === "https://gs1-epcis-reg.org/rail/rail-context.jsonld") {
    return { document: { "@context": railContext }, documentUrl: url };
  }
  throw new Error("unexpected fetch of " + url);
};

/** Builds a minimal-but-complete VocabTerm for tests, filling in fields the code under test doesn't care about with reasonable defaults. */
function testVocabTerm(overrides: Partial<VocabTerm> & Pick<VocabTerm, "id" | "relations">): VocabTerm {
  return {
    localName: overrides.id.split(/[/#]/).pop() ?? overrides.id,
    label: overrides.id,
    types: [],
    domainSlug: "test",
    sourceArtifactUrl: "https://example.org/test-artifact.jsonld",
    raw: {},
    ...overrides,
  };
}

/** The class-hierarchy fact this data's shapes rely on for their sh:targetClass to match at all — see bug #3 above. In the real app this comes from the domain's own published ontology via buildClassHierarchyQuads(); synthesized directly here since these fixtures aren't a published domain. */
const objectEventIsAnEpcisEvent: VocabTerm[] = [
  testVocabTerm({
    id: EPCIS + "ObjectEvent",
    types: ["owl:Class"],
    relations: { "rdfs:subClassOf": [EPCIS + "EPCISEvent"] },
  }),
];

async function loadFixtureData() {
  const { quads } = await parseRdfText(JSON.stringify(dataDoc), "jsonld", undefined, documentLoader, "data");
  return quads;
}
async function loadFixtureShapes() {
  const { quads } = await parseRdfText(JSON.stringify(shapesDoc), "jsonld", undefined, documentLoader, "shapes");
  return quads;
}

describe("SHACL @id-typing fix (bug #1)", () => {
  it("without shapes-role parsing, sh:targetClass/sh:path expand to string literals, not IRIs", async () => {
    // role: "data" deliberately used here even though this is a shapes
    // document — this is what shows the bug directly: reproduces the
    // original, broken behavior for comparison against the fix below.
    const { quads } = await parseRdfText(JSON.stringify(shapesDoc), "jsonld", undefined, documentLoader, "data");
    const targetClassTriples = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#targetClass");
    expect(targetClassTriples.length).toBeGreaterThan(0);
    for (const t of targetClassTriples) {
      expect(t.object.termType).toBe("Literal");
    }
  });

  it("with role: \"shapes\", sh:targetClass/sh:path correctly expand to NamedNode IRIs", async () => {
    const quads = await loadFixtureShapes();
    const targetClassTriples = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#targetClass");
    const pathTriples = quads.filter((q) => q.predicate.value === "http://www.w3.org/ns/shacl#path");
    expect(targetClassTriples.length).toBeGreaterThan(0);
    expect(pathTriples.length).toBeGreaterThan(0);
    for (const t of [...targetClassTriples, ...pathTriples]) {
      expect(t.object.termType).toBe("NamedNode");
    }
    // And specifically the value this whole investigation started from:
    expect(targetClassTriples.some((t) => t.object.value === EPCIS + "EPCISEvent")).toBe(true);
  });
});

describe("SHACL-SPARQL constraints don't crash the run (bug #2)", () => {
  it("validate() doesn't throw, even though MasterDataLinkShape uses sh:sparql", async () => {
    const dataQuads = await loadFixtureData();
    const shapeQuads = await loadFixtureShapes();
    await expect(validate(shapeQuads, dataQuads)).resolves.toBeDefined();
  });

  it("reports an engineWarning naming the skipped SPARQL shape, instead of silently dropping it", async () => {
    const dataQuads = await loadFixtureData();
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);
    expect(report.engineWarnings.length).toBeGreaterThan(0);
    expect(report.engineWarnings.some((w) => w.includes("MasterDataLinkShape"))).toBe(true);
    expect(report.engineWarnings.some((w) => w.includes("sh:sparql"))).toBe(true);
  });

  it("still runs every other (non-SPARQL) shape despite the SPARQL one being present", async () => {
    const dataQuads = [...(await loadFixtureData()), ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);
    // PersistentDispositionForbidden (bug #3's negative case, see below)
    // still fires correctly even with the unrelated SPARQL shape present.
    expect(report.results.length).toBeGreaterThan(0);
  });
});

describe("Class-hierarchy merging for abstract sh:targetClass (bug #3)", () => {
  it("NEGATIVE: without the class-hierarchy fact merged in, PersistentDispositionForbidden never even matches the event, so its violation is missed entirely", async () => {
    const dataQuads = await loadFixtureData(); // no class hierarchy merged in
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);
    expect(report.conforms).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  it("POSITIVE/NEGATIVE: with the class-hierarchy fact merged in, the same data now correctly reports a violation for the forbidden epcis:persistentDisposition property", async () => {
    const dataQuads = [...(await loadFixtureData()), ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);

    expect(report.conforms).toBe(false);
    const persistentDispositionViolation = report.results.find((r) =>
      r.sourceShape?.endsWith("PersistentDispositionForbidden")
    );
    expect(persistentDispositionViolation).toBeDefined();
    expect(persistentDispositionViolation?.severity).toBe("Violation");
  });

  it("finding: PersistentDispositionForbidden as WRITTEN always reports a violation, even when the forbidden property is absent — a bug in the shapes file itself, not this validator", async () => {
    // sh:not negates an inner shape of just {sh:path: epcis:persistentDisposition}
    // with no sh:minCount — a property shape with no actual constraint
    // trivially conforms for ANY node, present-or-absent, so sh:not (the
    // negation of an always-true inner shape) is always violated. The
    // shape needs "sh:minCount": 1 inside the negated shape to mean what
    // it's clearly intended to mean ("this property must not be present").
    // Documented here rather than silently worked around, since it's data
    // the person who wrote the shapes file should fix, not something a
    // validation engine can infer on its own.
    const cleanedDataDoc = JSON.parse(JSON.stringify(dataDoc));
    delete cleanedDataDoc.epcisBody.eventList[0]["epcis:persistentDisposition"];

    const { quads: cleanDataQuads } = await parseRdfText(
      JSON.stringify(cleanedDataDoc),
      "jsonld",
      undefined,
      documentLoader,
      "data"
    );
    const dataQuads = [...cleanDataQuads, ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);

    const persistentDispositionViolation = report.results.find((r) =>
      r.sourceShape?.endsWith("PersistentDispositionForbidden")
    );
    expect(persistentDispositionViolation).toBeDefined();
  });

  it("the corrected version of that shape (sh:minCount: 1 added inside sh:not) behaves as intended: violates when present, conforms when absent", async () => {
    const fixedShapesDoc = JSON.parse(JSON.stringify(shapesDoc));
    const forbidden = fixedShapesDoc["@graph"].find((n: { "@id"?: string }) => n["@id"] === "epcis:PersistentDispositionForbidden");
    forbidden["sh:not"]["sh:property"][0]["sh:minCount"] = 1;
    const { quads: fixedShapeQuads } = await parseRdfText(
      JSON.stringify(fixedShapesDoc),
      "jsonld",
      undefined,
      documentLoader,
      "shapes"
    );

    // present -> violation
    const withProperty = [...(await loadFixtureData()), ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const reportWith = await validate(fixedShapeQuads, withProperty);
    expect(reportWith.results.some((r) => r.sourceShape?.endsWith("PersistentDispositionForbidden"))).toBe(true);

    // absent -> conforms
    const cleanedDataDoc = JSON.parse(JSON.stringify(dataDoc));
    delete cleanedDataDoc.epcisBody.eventList[0]["epcis:persistentDisposition"];
    const { quads: cleanDataQuads } = await parseRdfText(
      JSON.stringify(cleanedDataDoc),
      "jsonld",
      undefined,
      documentLoader,
      "data"
    );
    const withoutProperty = [...cleanDataQuads, ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const reportWithout = await validate(fixedShapeQuads, withoutProperty);
    expect(reportWithout.results.some((r) => r.sourceShape?.endsWith("PersistentDispositionForbidden"))).toBe(false);
  });

  it("POSITIVE: eventTime/eventTimeZoneOffset correctly produce no violations when both are present", async () => {
    const dataQuads = [...(await loadFixtureData()), ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);
    const eventTimeRelated = report.results.filter(
      (r) => r.path === EPCIS + "eventTime" || r.path === EPCIS + "eventTimeZoneOffset"
    );
    expect(eventTimeRelated).toHaveLength(0);
  });

  it("NEGATIVE: removing eventTime correctly produces a minCount violation (sourceShape for a property constraint is the anonymous property shape itself, not the enclosing EPCISEventShape — that's standard SHACL behavior, not a bug)", async () => {
    const brokenDataDoc = JSON.parse(JSON.stringify(dataDoc));
    delete brokenDataDoc.epcisBody.eventList[0].eventTime;

    const { quads: brokenDataQuads } = await parseRdfText(
      JSON.stringify(brokenDataDoc),
      "jsonld",
      undefined,
      documentLoader,
      "data"
    );
    const dataQuads = [...brokenDataQuads, ...buildClassHierarchyQuads(objectEventIsAnEpcisEvent)];
    const shapeQuads = await loadFixtureShapes();
    const report = await validate(shapeQuads, dataQuads);

    const eventTimeViolation = report.results.find((r) => r.path === EPCIS + "eventTime");
    expect(eventTimeViolation).toBeDefined();
    expect(eventTimeViolation?.severity).toBe("Violation");
    expect(eventTimeViolation?.message).toContain("eventTime is required");
  });
});

describe("buildClassHierarchyQuads", () => {
  it("emits one rdfs:subClassOf quad per relation, and nothing for terms without any", () => {
    const { namedNode } = DataFactory;
    const terms: VocabTerm[] = [
      testVocabTerm({ id: "http://example.org/B", relations: { "rdfs:subClassOf": ["http://example.org/A"] } }),
      testVocabTerm({ id: "http://example.org/C", relations: {} }),
    ];
    const quads = buildClassHierarchyQuads(terms);
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.equals(namedNode("http://example.org/B"))).toBe(true);
    expect(quads[0].predicate.value).toBe("http://www.w3.org/2000/01/rdf-schema#subClassOf");
    expect(quads[0].object.equals(namedNode("http://example.org/A"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { buildFieldRows } from "../VersionCompare";
import type { VocabTerm } from "@/types/registry";

function term(overrides: Partial<VocabTerm>): VocabTerm {
  return {
    id: "rail:geo",
    localName: "geo",
    label: "Geo",
    types: ["owl:DatatypeProperty"],
    domainSlug: "rail",
    sourceArtifactUrl: "https://example.org/x.jsonld",
    relations: {},
    raw: {},
    ...overrides,
  };
}

describe("buildFieldRows", () => {
  it("marks unchanged fields as unchanged and changed fields as changed", () => {
    const a = term({ label: "Geo coordinates", description: "Old description" });
    const b = term({ label: "Geo coordinates", description: "New description" });
    const rows = buildFieldRows(a, b);

    const label = rows.find((r) => r.field === "label")!;
    expect(label.changed).toBe(false);

    const description = rows.find((r) => r.field === "description")!;
    expect(description.changed).toBe(true);
    expect(description.a).toBe("Old description");
    expect(description.b).toBe("New description");
  });

  it("shows an em dash for a field missing entirely from one version", () => {
    const rows = buildFieldRows(undefined, term({}));
    const label = rows.find((r) => r.field === "label")!;
    expect(label.a).toBe("—");
    expect(label.changed).toBe(true);
  });

  it("unions relation predicates across both versions, filling gaps with an em dash", () => {
    const a = term({ relations: { "rdfs:domain": ["gs1:Place"] } });
    const b = term({ relations: { "rdfs:range": ["xsd:string"] } });
    const rows = buildFieldRows(a, b);

    const domainRow = rows.find((r) => r.field === "rdfs:domain")!;
    expect(domainRow.a).toBe("gs1:Place");
    expect(domainRow.b).toBe("—");

    const rangeRow = rows.find((r) => r.field === "rdfs:range")!;
    expect(rangeRow.a).toBe("—");
    expect(rangeRow.b).toBe("xsd:string");
  });

  it("sorts multi-valued types before comparing, so reordering alone isn't reported as a change", () => {
    const a = term({ types: ["rdf:Property", "owl:DatatypeProperty"] });
    const b = term({ types: ["owl:DatatypeProperty", "rdf:Property"] });
    const rows = buildFieldRows(a, b);
    const typeRow = rows.find((r) => r.field === "type")!;
    expect(typeRow.changed).toBe(false);
  });
});

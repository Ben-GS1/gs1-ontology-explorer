import { describe, expect, it } from "vitest";
import { detectLikelyDomains, extractUsedTermIris } from "../detectDomain";
import { parseJsonLd } from "../rdf";

describe("extractUsedTermIris", () => {
  it("collects predicate IRIs and rdf:type object IRIs, ignoring literal objects", async () => {
    const quads = await parseJsonLd({
      "@context": { ex: "http://example.org/", name: "ex:name", Wagon: "ex:Wagon" },
      "@id": "ex:w1",
      "@type": "Wagon",
      name: "literal value should not appear as an iri",
    });
    const iris = extractUsedTermIris(quads);
    expect(iris.has("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")).toBe(true);
    expect(iris.has("http://example.org/Wagon")).toBe(true);
    expect(iris.has("http://example.org/name")).toBe(true);
    expect(Array.from(iris)).not.toContain("literal value should not appear as an iri");
  });
});

describe("detectLikelyDomains", () => {
  it("ranks the domain whose known terms overlap most with the data first", async () => {
    const quads = await parseJsonLd({
      "@context": { rail: "http://ex.org/rail#", wagonNumber: "rail:wagonNumber", Wagon: "rail:Wagon" },
      "@id": "rail:w1",
      "@type": "Wagon",
      wagonNumber: "123",
    });

    const matches = detectLikelyDomains(quads, [
      { domainSlug: "rail", knownTermIris: new Set(["http://ex.org/rail#Wagon", "http://ex.org/rail#wagonNumber"]) },
      { domainSlug: "bearing", knownTermIris: new Set(["http://ex.org/bearing#Material"]) },
    ]);

    expect(matches[0].domainSlug).toBe("rail");
    expect(matches[0].overlapCount).toBe(2);
  });

  it("excludes domains with zero overlap rather than returning them with count 0", async () => {
    const quads = await parseJsonLd({
      "@context": { ex: "http://example.org/", Foo: "ex:Foo" },
      "@id": "ex:x",
      "@type": "Foo",
    });
    const matches = detectLikelyDomains(quads, [
      { domainSlug: "unrelated", knownTermIris: new Set(["http://ex.org/rail#Wagon"]) },
    ]);
    expect(matches).toHaveLength(0);
  });
});

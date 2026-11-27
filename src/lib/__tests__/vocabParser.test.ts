import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractOntologyMetadata, parseVocabularyDocument } from "../vocabParser";

const fixturePath = fileURLToPath(new URL("./fixtures/gs1RailVoc.jsonld", import.meta.url));
const railVoc = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("parseVocabularyDocument (real GS1 Rail vocabulary)", () => {
  const terms = parseVocabularyDocument(railVoc, {
    domainSlug: "rail",
    sourceArtifactUrl: "https://gs1-epcis-reg.org/rail/voc/data/gs1RailVoc.jsonld",
  });

  it("extracts every term node but excludes the ontology header node", () => {
    // 7 term-like nodes in the fixture (europeanTrackLocation, geo,
    // NominalValueSet, DynamicCoefficient, typeWtms-WILD, railRunDistance)
    // plus the "rail:" ontology header, which must be excluded.
    expect(terms.find((t) => t.id === "rail:")).toBeUndefined();
    expect(terms.length).toBeGreaterThanOrEqual(6);
  });

  it("resolves rdfs:label from the {@language,@value} object form", () => {
    const geo = terms.find((t) => t.localName === "geo");
    expect(geo?.label).toBe("Geo coordinates, Lat, Long");
    expect(geo?.description).toContain("geo-coordinates");
  });

  it("falls back to the local name when no label predicate is present", () => {
    const wtms = terms.find((t) => t.localName === "typeWtms-WILD");
    expect(wtms?.label).toBe("Wheel impact load detection");
  });

  it("captures rdfs:domain / rdfs:range as relation IRIs", () => {
    const geo = terms.find((t) => t.localName === "geo");
    expect(geo?.relations["rdfs:domain"]).toEqual(["gs1:Place"]);
  });

  it("captures the GS1-specific sw:term_status extension as termStatus", () => {
    const deprecated = terms.find((t) => t.localName === "DynamicCoefficient");
    expect(deprecated?.termStatus).toBe("deprecated");

    const stable = terms.find((t) => t.localName === "geo");
    expect(stable?.termStatus).toBe("stable");
  });

  it("captures schema:unitCode as unitCode, e.g. en15654Speed's 'KMH'", () => {
    const speed = terms.find((t) => t.localName === "en15654Speed");
    expect(speed?.unitCode).toBe("KMH");

    // A term with no schema:unitCode at all must not get a fabricated one.
    const geo = terms.find((t) => t.localName === "geo");
    expect(geo?.unitCode).toBeUndefined();
  });

  it("normalises @type whether it is a string or an array", () => {
    const singleType = terms.find((t) => t.localName === "railRunDistance");
    expect(singleType?.types).toEqual(["gs1:MeasurementType"]);

    const arrayType = terms.find((t) => t.localName === "geo");
    expect(arrayType?.types).toEqual(expect.arrayContaining(["owl:DatatypeProperty", "rdf:Property"]));
  });
});

describe("extractOntologyMetadata", () => {
  it("reads title, version and dates off the voaf:Vocabulary/owl:Ontology header node", () => {
    const meta = extractOntologyMetadata(railVoc);
    expect(meta?.title).toBe("GS1 Rail Vocabulary");
    expect(meta?.version).toBe("2.2");
    expect(meta?.preferredPrefix).toBe("rail");
  });
});

// ---------------------------------------------------------------------------
// Compact-term + language-map form, as produced by a context that defines
// label/comment/title/description with `"@container": "@language"` and
// subClassOf/domain/range/… with `"@type": "@id"`.
// ---------------------------------------------------------------------------

const multilingualPath = fileURLToPath(new URL("./fixtures/gs1CompactMultilingual.jsonld", import.meta.url));
const multilingualDoc = JSON.parse(readFileSync(multilingualPath, "utf-8"));

describe("parseVocabularyDocument (compact terms, language maps)", () => {
  const terms = parseVocabularyDocument(multilingualDoc, {
    domainSlug: "test",
    sourceArtifactUrl: "https://example.org/test.jsonld",
  });
  const byName = (name: string) => terms.find((t) => t.localName === name)!;

  it("excludes the ontology header node", () => {
    expect(terms.find((t) => t.localName === "")).toBeUndefined();
    expect(terms.map((t) => t.localName).sort()).toEqual(
      ["Place", "bothPredicates", "geo", "germanOnly", "legacyTerm", "mixedForms", "noLabel", "untagged"].sort()
    );
  });

  it("reads label and comment language maps in full", () => {
    const place = byName("Place");
    expect(place.labels).toMatchObject({ en: "Place", de: "Ort", fr: "Lieu" });
    expect(place.descriptions).toMatchObject({
      en: "A physical location.",
      de: "Ein physischer Standort.",
      fr: "Un emplacement physique.",
    });
  });

  it("uses English as the default label/description and keeps translations separately", () => {
    const place = byName("Place");
    expect(place.label).toBe("Place");
    expect(place.description).toBe("A physical location.");
  });

  it("merges translations from duplicate nodes of the same @id", () => {
    const place = byName("Place");
    expect(Object.keys(place.labels ?? {}).sort()).toEqual(["de", "en", "fr", "it"]);
    expect(place.descriptions?.it).toBe("Una posizione fisica.");
    // The first occurrence wins for properties both nodes define.
    expect(place.termStatus).toBe("stable");
  });

  it("lower-cases regional language tags", () => {
    expect(byName("geo").labels).toEqual({ en: "Geo coordinates", "de-ch": "Geokoordinaten" });
  });

  it("falls back to dct:title / dct:description when there is no rdfs:label / rdfs:comment", () => {
    const legacy = byName("legacyTerm");
    expect(legacy.labels).toEqual({ en: "Legacy term", de: "Altbegriff" });
    expect(legacy.label).toBe("Legacy term");
    expect(legacy.descriptions?.de).toContain("dct:title");
    expect(legacy.termStatus).toBe("deprecated");
  });

  it("keeps a language from a lower-priority predicate when a higher one lacks it", () => {
    const both = byName("bothPredicates");
    expect(both.labels).toEqual({ en: "From rdfs:label", de: "Aus dct:title" });
  });

  it("understands {@language,@value} arrays, @value objects inside a map, and several values per language", () => {
    const mixed = byName("mixedForms");
    expect(mixed.labels).toEqual({ en: "Mixed forms", de: "Gemischte Formen" });
    expect(mixed.descriptions?.en).toBe("First paragraph.\n\nSecond paragraph.");
    expect(mixed.descriptions?.de).toBe("Ein Absatz.");
  });

  it("stores untagged literals under 'und'", () => {
    const untagged = byName("untagged");
    expect(untagged.labels).toEqual({ und: "Untagged label" });
    expect(untagged.label).toBe("Untagged label");
    expect(untagged.description).toBe("Untagged comment.");
  });

  it("uses the first available language as default when there is no English", () => {
    const german = byName("germanOnly");
    expect(german.label).toBe("Nur Deutsch");
    expect(german.description).toBe("Nur eine deutsche Definition.");
  });

  it("falls back to the local name — with no translations — when a term has no label at all", () => {
    const bare = byName("noLabel");
    expect(bare.label).toBe("noLabel");
    expect(bare.labels).toBeUndefined();
    expect(bare.descriptions).toBeUndefined();
  });

  it("maps compact relation terms to their canonical predicates and expands known prefixes", () => {
    const place = byName("Place");
    expect(place.relations["rdfs:subClassOf"]).toEqual(["https://ref.gs1.org/voc/Thing"]);
    expect(place.relations["rdfs:isDefinedBy"]).toEqual(["https://ref.gs1.org/voc/"]);
    expect(place.relations["skos:inScheme"]).toEqual(["https://ref.gs1.org/voc/LocationScheme"]);
    expect(place.relations["rdfs:seeAlso"]).toEqual([
      "https://ref.gs1.org/voc/GeoCoordinates",
      "https://schema.org/Place",
    ]);

    const geo = byName("geo");
    expect(geo.relations["rdfs:domain"]).toEqual(["https://ref.gs1.org/voc/Place"]);
    expect(geo.relations["rdfs:range"]).toEqual(["http://www.w3.org/2001/XMLSchema#string"]);
    expect(geo.relations["sai:usedWithLinkType"]).toEqual(["https://ref.gs1.org/voc/geoLink"]);
  });

  it("does not invent relations a term does not have", () => {
    expect(byName("untagged").relations).toEqual({});
  });

  it("reads termStatus, versionInfo, created (plain or typed) and license (string or @id)", () => {
    const place = byName("Place");
    expect(place.termStatus).toBe("stable");
    expect(place.versionInfo).toBe("1.2");
    expect(place.created).toBe("2024-05-01");
    expect(place.license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(byName("untagged").versionInfo).toBeUndefined();
    expect(byName("untagged").license).toBeUndefined();
  });

  it("recognises predicates written as full IRIs", () => {
    const expanded = parseVocabularyDocument(
      {
        "@graph": [
          {
            "@id": "https://example.org/x",
            "@type": "http://www.w3.org/2002/07/owl#Class",
            "http://www.w3.org/2000/01/rdf-schema#label": [
              { "@language": "en", "@value": "X" },
              { "@language": "de", "@value": "Ix" },
            ],
            "http://www.w3.org/2000/01/rdf-schema#subClassOf": [{ "@id": "https://example.org/y" }],
          },
        ],
      },
      { domainSlug: "t", sourceArtifactUrl: "https://example.org/t.jsonld" }
    );
    expect(expanded[0].labels).toEqual({ en: "X", de: "Ix" });
    expect(expanded[0].relations["rdfs:subClassOf"]).toEqual(["https://example.org/y"]);
  });
});

describe("extractOntologyMetadata (compact terms, language maps)", () => {
  const meta = extractOntologyMetadata(multilingualDoc);

  it("reads translated title and description off the header node", () => {
    expect(meta?.titles).toEqual({ en: "GS1 Test Vocabulary", de: "GS1 Testvokabular" });
    expect(meta?.descriptions?.de).toBe("Ein Vokabular für Tests.");
    expect(meta?.title).toBe("GS1 Test Vocabulary");
    expect(meta?.description).toBe("A vocabulary used for testing.");
  });

  it("reads version, creation date and license", () => {
    expect(meta?.version).toBe("3.1");
    expect(meta?.issued).toBe("2025-01-15");
    expect(meta?.license).toBe("https://creativecommons.org/licenses/by/4.0/");
  });

  it("still returns plain-string titles for the classic header form", () => {
    const classic = extractOntologyMetadata(railVoc);
    expect(classic?.title).toBe("GS1 Rail Vocabulary");
    expect(classic?.titles).toEqual({ und: "GS1 Rail Vocabulary" });
  });
});

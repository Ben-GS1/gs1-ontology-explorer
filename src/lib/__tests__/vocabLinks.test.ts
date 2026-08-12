import { describe, expect, it } from "vitest";
import { resolveTypeDefinitionUrl } from "@/lib/vocabLinks";

describe("resolveTypeDefinitionUrl", () => {
  it("links compact gs1: types to ref.gs1.org/voc/, not the raw namespace host", () => {
    expect(resolveTypeDefinitionUrl("gs1:MeasurementType")).toBe("https://ref.gs1.org/voc/MeasurementType");
  });

  it("links an already-expanded gs1.org/voc/ IRI to the ref.gs1.org canonical docs host", () => {
    expect(resolveTypeDefinitionUrl("https://gs1.org/voc/MeasurementType")).toBe(
      "https://ref.gs1.org/voc/MeasurementType"
    );
  });

  it("links compact schema: types to schema.org directly", () => {
    expect(resolveTypeDefinitionUrl("schema:Product")).toBe("https://schema.org/Product");
  });

  it("links an already-expanded schema.org IRI to itself", () => {
    expect(resolveTypeDefinitionUrl("https://schema.org/Product")).toBe("https://schema.org/Product");
  });

  it("links compact rdf:/rdfs:/owl:/xsd: types to their W3C namespace anchors", () => {
    expect(resolveTypeDefinitionUrl("owl:DatatypeProperty")).toBe(
      "http://www.w3.org/2002/07/owl#DatatypeProperty"
    );
    expect(resolveTypeDefinitionUrl("rdfs:Class")).toBe("http://www.w3.org/2000/01/rdf-schema#Class");
    expect(resolveTypeDefinitionUrl("rdf:Property")).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#Property");
    expect(resolveTypeDefinitionUrl("xsd:string")).toBe("http://www.w3.org/2001/XMLSchema#string");
  });

  it("falls back to the IRI itself for any other absolute http(s) IRI", () => {
    expect(resolveTypeDefinitionUrl("https://gs1-epcis-reg.org/rail/voc/data#Wagon")).toBe(
      "https://gs1-epcis-reg.org/rail/voc/data#Wagon"
    );
  });

  it("returns undefined for a compact CURIE with an unrecognised prefix", () => {
    expect(resolveTypeDefinitionUrl("disco:DataProcessingMethod")).toBeUndefined();
  });
});

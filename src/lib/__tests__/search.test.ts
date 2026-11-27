import { describe, expect, it } from "vitest";
import { buildSearchIndex, termMatchesQuery } from "../search";
import type { VocabTerm } from "@/types/registry";

function term(overrides: Partial<VocabTerm>): VocabTerm {
  return {
    id: "gs1:x",
    localName: "x",
    label: "x",
    types: [],
    domainSlug: "test",
    sourceArtifactUrl: "https://example.org/t.jsonld",
    relations: {},
    raw: {},
    ...overrides,
  };
}

const place = term({
  id: "gs1:Place",
  localName: "Place",
  label: "Place",
  description: "A physical location.",
  labels: { en: "Place", de: "Ort", fr: "Lieu" },
  descriptions: { en: "A physical location.", de: "Ein physischer Standort." },
});
const other = term({ id: "gs1:Other", localName: "Other", label: "Other", labels: { en: "Other", de: "Anderes" } });

describe("termMatchesQuery", () => {
  it("matches the label in any language", () => {
    expect(termMatchesQuery(place, "ort")).toBe(true);
    expect(termMatchesQuery(place, "lieu")).toBe(true);
  });

  it("matches the description in any language", () => {
    expect(termMatchesQuery(place, "standort")).toBe(true);
  });

  it("still matches the local name and default label", () => {
    expect(termMatchesQuery(place, "plac")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(termMatchesQuery(place, "zebra")).toBe(false);
  });
});

describe("buildSearchIndex", () => {
  const fuse = buildSearchIndex([place, other]);

  it("finds a term by its German label", () => {
    const hits = fuse.search("Standort").map((r) => r.item.localName);
    expect(hits).toContain("Place");
  });

  it("finds a term by a French label", () => {
    expect(fuse.search("Lieu")[0]?.item.localName).toBe("Place");
  });

  it("finds a term by its default label", () => {
    expect(fuse.search("Other")[0]?.item.localName).toBe("Other");
  });
});

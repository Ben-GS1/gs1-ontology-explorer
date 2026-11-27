import { describe, expect, it } from "vitest";
import {
  describeLanguage,
  languagesIn,
  localizeTerm,
  mergeLangMaps,
  normalizeLangTag,
  pickLocalized,
  resolvePreferredLanguages,
} from "../localized";

describe("normalizeLangTag", () => {
  it("lower-cases and normalises separators", () => {
    expect(normalizeLangTag("de-CH")).toBe("de-ch");
    expect(normalizeLangTag("zh_Hans")).toBe("zh-hans");
  });

  it("maps @none / empty / 'und' to the undetermined tag", () => {
    expect(normalizeLangTag("@none")).toBe("und");
    expect(normalizeLangTag("")).toBe("und");
    expect(normalizeLangTag("und")).toBe("und");
  });

  it("rejects things that are not language tags", () => {
    expect(normalizeLangTag("@context")).toBeUndefined();
    expect(normalizeLangTag("not a tag")).toBeUndefined();
    expect(normalizeLangTag("x")).toBeUndefined();
    expect(normalizeLangTag(42)).toBeUndefined();
  });
});

describe("pickLocalized", () => {
  const map = { en: "Place", de: "Ort", "fr-ch": "Lieu" };

  it("returns undefined for a missing or empty map", () => {
    expect(pickLocalized(undefined, ["de"])).toBeUndefined();
    expect(pickLocalized({}, ["de"])).toBeUndefined();
  });

  it("prefers an exact match", () => {
    expect(pickLocalized(map, ["de"])).toEqual({ text: "Ort", lang: "de" });
  });

  it("matches a regional preference to the base language", () => {
    expect(pickLocalized(map, ["de-CH"])).toEqual({ text: "Ort", lang: "de" });
  });

  it("matches a base-language preference to a regional variant", () => {
    expect(pickLocalized(map, ["fr"])).toEqual({ text: "Lieu", lang: "fr-ch" });
  });

  it("walks the preference list in order", () => {
    expect(pickLocalized(map, ["it", "fr", "de"])?.text).toBe("Lieu");
  });

  it("falls back to English, then untagged, then the first entry", () => {
    expect(pickLocalized(map, ["it"])).toEqual({ text: "Place", lang: "en" });
    expect(pickLocalized({ und: "Plain", de: "Ort" }, ["it"])).toEqual({ text: "Plain", lang: undefined });
    expect(pickLocalized({ de: "Ort", fr: "Lieu" }, ["it"])).toEqual({ text: "Ort", lang: "de" });
  });

  it("reports untagged text as having no language", () => {
    expect(pickLocalized({ und: "Plain" }, ["de"])?.lang).toBeUndefined();
  });

  it("ignores invalid preference entries", () => {
    expect(pickLocalized(map, ["@context", "de"])?.text).toBe("Ort");
  });
});

describe("mergeLangMaps / languagesIn / resolvePreferredLanguages", () => {
  it("merges maps with the earlier map winning per language", () => {
    expect(mergeLangMaps({ en: "A" }, undefined, { en: "B", de: "C" })).toEqual({ en: "A", de: "C" });
  });

  it("lists real languages sorted, without 'und'", () => {
    expect(languagesIn({ en: "a", und: "x" }, { de: "b" }, undefined)).toEqual(["de", "en"]);
  });

  it("puts an explicit choice before the browser languages and removes duplicates", () => {
    expect(resolvePreferredLanguages("fr", ["de-CH", "de", "fr"])).toEqual(["fr", "de-ch", "de"]);
  });

  it("works without an explicit choice or browser languages", () => {
    expect(resolvePreferredLanguages(null, ["en-US"])).toEqual(["en-us"]);
    expect(resolvePreferredLanguages(undefined)).toEqual([]);
  });
});

describe("localizeTerm", () => {
  const term = {
    label: "Place",
    description: "A physical location.",
    labels: { en: "Place", de: "Ort" },
    descriptions: { en: "A physical location.", de: "Ein physischer Standort." },
  };

  it("resolves label and description in the preferred language", () => {
    const loc = localizeTerm(term, ["de"]);
    expect(loc.label).toEqual({ text: "Ort", lang: "de" });
    expect(loc.description).toEqual({ text: "Ein physischer Standort.", lang: "de" });
  });

  it("falls back to the parser's default label/description for terms without translations", () => {
    const loc = localizeTerm({ label: "geo", description: "Plain." }, ["de"]);
    expect(loc.label).toEqual({ text: "geo" });
    expect(loc.description).toEqual({ text: "Plain." });
  });

  it("has no description when the term has none", () => {
    expect(localizeTerm({ label: "geo" }, ["de"]).description).toBeUndefined();
  });
});

describe("describeLanguage", () => {
  it("names a language in the requested language", () => {
    expect(describeLanguage("de", "en")).toBe("German");
    expect(describeLanguage("de", "de")).toBe("Deutsch");
  });

  it("falls back to the raw tag when it cannot be named", () => {
    expect(describeLanguage("!!", "en")).toBe("!!");
  });
});

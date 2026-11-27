import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseVocabularyDocument } from "@/lib/vocabParser";
import type { VocabTerm } from "@/types/registry";
import common from "../../../public/locales/en/common.json";

// The real English strings, so the tests also fail if a key used by the page is missing from common.json.
await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "sectors", "errors"],
  defaultNS: "common",
  resources: { en: { common, sectors: {}, errors: {} } },
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

// Real parser output from the multilingual fixture, so these tests cover the
// whole path: JSON-LD -> VocabTerm -> rendered page.
const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../lib/__tests__/fixtures/gs1CompactMultilingual.jsonld", import.meta.url)), "utf-8")
);
const terms = parseVocabularyDocument(doc, { domainSlug: "test", sourceArtifactUrl: "https://example.org/t.jsonld" });
const place = terms.find((t) => t.localName === "Place")!;
const untagged = terms.find((t) => t.localName === "untagged")!;

// react-router warns that useLayoutEffect is a no-op when rendering to a string.
// That is expected for these server-side render checks, so only that one message
// is filtered out — any other console error still shows up.
beforeAll(() => {
  const original = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    original(...args);
  });
});

let currentTerm: VocabTerm | undefined = place;

vi.mock("@/hooks/useRegistry", () => ({
  useDomain: () => ({
    isLoading: false,
    domain: { slug: "test", labelKey: "test", label: "Test domain", artifacts: [] },
  }),
  useManifest: () => ({ data: { domains: [] } }),
  useSectors: () => ({ data: [] }),
  useDomains: () => ({ data: [] }),
  useTermAtVersion: () => ({ isLoading: false, data: currentTerm }),
}));

// Imported after vi.mock so the page picks up the mocked hooks.
const { TermPage } = await import("../TermPage");
const { TermRow } = await import("@/components/TermRow");

function renderTermPage(search: string, term: VocabTerm = place): string {
  currentTerm = term;
  return renderToStaticMarkup(
    createElement(
      HelmetProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [`/test/${term.localName}${search}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/:domainSlug/:termName", element: createElement(TermPage) })
        )
      )
    )
  );
}

describe("TermPage — translated definitions", () => {
  it("shows the label and definition in the language chosen via ?lng=", () => {
    const html = renderTermPage("?lng=de");
    expect(html).toContain('<h1 lang="de"');
    expect(html).toContain(">Ort</h1>");
    expect(html).toContain("Ein physischer Standort.");
  });

  it("shows French when asked for French", () => {
    const html = renderTermPage("?lng=fr");
    expect(html).toContain(">Lieu</h1>");
    expect(html).toContain("Un emplacement physique.");
  });

  it("falls back to English when the requested language does not exist", () => {
    const html = renderTermPage("?lng=ja");
    expect(html).toContain(">Place</h1>");
    expect(html).toContain("A physical location.");
  });

  it("lists every translation in a table", () => {
    const html = renderTermPage("?lng=de");
    expect(html).toContain(">Translations<");
    expect(html).toContain("German");
    expect(html).toContain("French");
    expect(html).toContain("Italian");
    for (const text of ["Place", "Ort", "Lieu", "Luogo", "Ein physischer Standort.", "Una posizione fisica."]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('lang="it"');
  });

  it("offers the available languages in the language picker", () => {
    const html = renderTermPage("");
    expect(html).toContain("Definition language");
    expect(html).toContain("Automatic");
    for (const lang of ["de", "en", "fr", "it"]) expect(html).toContain(`value="${lang}"`);
  });

  it("shows the newly supported metadata: version, created, license and relations", () => {
    const html = renderTermPage("");
    expect(html).toContain("1.2"); // versionInfo
    expect(html).toContain("2024-05-01"); // created
    expect(html).toContain("https://creativecommons.org/licenses/by/4.0/"); // license
    expect(html).toContain("https://ref.gs1.org/voc/Thing"); // subClassOf
    expect(html).toContain("https://ref.gs1.org/voc/LocationScheme"); // inScheme
    expect(html).toContain("https://schema.org/Place"); // seeAlso
    // Predicates get a readable name, with the CURIE kept as a tooltip.
    expect(html).toContain('title="rdfs:subClassOf"');
    expect(html).toContain(">Sub-class of<");
    expect(html).toContain(">In scheme<");
    expect(html).toContain(">See also<");
    expect(html).toContain(">Defined by<");
    expect(html).toContain(">Version<");
    expect(html).toContain(">Created<");
    expect(html).toContain(">License<");
  });

  it("shows domain, range and used-with-link-type of a property", () => {
    const html = renderTermPage("", terms.find((t) => t.localName === "geo")!);
    expect(html).toContain(">Domain<");
    expect(html).toContain(">Range<");
    expect(html).toContain(">Used with link type<");
    expect(html).toContain("https://ref.gs1.org/voc/geoLink");
    // 'de-CH' is a regional variant: a German reader gets it.
    expect(renderTermPage("?lng=de", terms.find((t) => t.localName === "geo")!)).toContain(">Geokoordinaten</h1>");
  });

  it("links IRIs to their definitions", () => {
    const html = renderTermPage("");
    expect(html).toContain('href="https://schema.org/Place"');
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(html).toContain('title="Opens this link in a new tab"');
  });

  it("shows no translation table or language picker for a term without translations", () => {
    const html = renderTermPage("", untagged);
    expect(html).toContain(">Untagged label</h1>");
    expect(html).toContain("Untagged comment.");
    expect(html).not.toContain(">Translations<");
    expect(html).not.toContain("Definition language");
  });
});

describe("TermRow — translated definitions", () => {
  function renderRow(search: string): string {
    return renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: [`/test${search}`] }, createElement(TermRow, { term: place }))
    );
  }

  it("shows label and description in the chosen language", () => {
    const html = renderRow("?lng=de");
    expect(html).toContain(">Ort</h3>");
    expect(html).toContain("Ein physischer Standort.");
  });

  it("carries the language choice into the link to the term page", () => {
    expect(renderRow("?lng=de")).toContain('href="/test/Place?lng=de"');
  });

  it("adds nothing to the link when no language was chosen", () => {
    expect(renderRow("")).toContain('href="/test/Place"');
  });
});
